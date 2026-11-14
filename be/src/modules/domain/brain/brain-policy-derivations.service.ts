import { Injectable, Optional, type OnModuleInit } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { BrainFactsService, brainFactsEntities, type FactsChangedHook } from "@modules/domain/brain-facts"
import { TeamChatNoticesService } from "@modules/domain/team-chat"
import { WorkspaceMembersService } from "@modules/domain/workspace-members"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { KnowledgeQueue } from "@modules/queues/knowledge"
import { MANAGERS } from "./founder.policy"
import { BrainPolicyDerivationEntity, type BrainPolicyDerivationError, type BrainPolicyDerivationStatus } from "./persistence/entities"
import { PolicyDeriveLogEvent } from "./policy-derive.log-events"

/** The facts table, for the one read across workspaces the backfill door makes. */
const BrainFactEntity: (typeof brainFactsEntities)[0] = brainFactsEntities[0]

/** A pass that waits or runs longer than this is taken for lost: the next request queues a new one. */
const STALE_MS = 15 * 60_000

/**
 * A pass given up on its model (`failed` / `model`) is NOT asked again by every later fact change for this long (D-BR-2 (e): six passes
 * in twenty minutes, each failing the same way): the tab says it failed and its door asks again at once; after this a change asks again.
 */
export const FAILED_COOLDOWN_MS: number = 30 * 60_000

/** The episode of a workspace whose pass never succeeded: one card for its failures until a first pass ends well. */
const NEVER_DERIVED = new Date(0)

/** The most workspaces one call of the backfill door asks a pass for. */
export const BACKFILL_MAX = 200

/** Where the derive pass of a workspace stands, as stored. */
export interface PolicyDerivationState {
    /** `queued`, `running`, `idle` or `failed`. */
    readonly status: BrainPolicyDerivationStatus
    /** When a change last asked for a pass. */
    readonly requestedAt: string
    /** When the last pass started. */
    readonly startedAt: string | null
    /** When a pass last left nothing to judge. */
    readonly derivedAt: string | null
    /** Tries that failed in a row. */
    readonly attempts: number
    /** Why the last pass failed, or null. */
    readonly error: BrainPolicyDerivationError | null
}

/** The state of a workspace's pass, or null when none was ever asked for. */
export type MaybePolicyDerivationState = PolicyDerivationState | null

/** The start of a pass: when it started. */
export interface PolicyPassStart {
    /** When the pass started. */
    readonly startedAt: Date
}

/** How a pass that left nothing to judge ended: the state is idle, or a change came during it and one more pass is queued. */
export type PolicyPassEnd = "idle" | "queued"

/** What asking for a pass did: a job was queued, or one already waits or runs (it will see the change). */
export type PolicyDeriveRequested = "queued" | "pending"

/** A stored row as a state. */
const toState = (row: BrainPolicyDerivationEntity): PolicyDerivationState => ({
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    derivedAt: row.derivedAt?.toISOString() ?? null,
    attempts: row.attempts,
    error: row.error,
})

/** Where the cli's backfill prints its one line (the process's stdout). */
export interface PolicyBackfillOutput {
    /** Writes one chunk of text. */
    write(text: string): unknown
}

@Injectable()
/**
 * When the policies of a workspace are derived: the state row of its derive pass and the ONE place a pass is asked for. The facts
 * store announces every change of what is in force (`BrainFactsService.whenChanged`: a value applied, retired, taken over at its start,
 * expired, or given another audience); this service answers by queueing one pass on the knowledge queue in the same transaction as
 * the state row, so a burst of changes is one job and a change during a pass makes the pass run once more. The announcement never
 * fails the fact write: a failure here is logged (`brain.policies.request_failed`) and the next change, or the backfill door, asks
 * again (a pass always compares the WHOLE workspace, so nothing is lost by a missed announcement).
 */
export class BrainPolicyDerivationsService implements OnModuleInit, FactsChangedHook {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
        private readonly queue: KnowledgeQueue,
        private readonly facts: BrainFactsService,
        private readonly members: WorkspaceMembersService,
        @Optional() private readonly notices?: TeamChatNoticesService,
    ) {}

    /** Listens to the facts store. */
    onModuleInit(): void {
        this.facts.whenChanged(this)
    }

    /**
     * The facts store's announcement: what is in force changed in a workspace. Never throws. While a pass given up on its model is
     * recent (`FAILED_COOLDOWN_MS`) a change does not ask again (its cause stands); the tab's door always does.
     */
    async factsChanged(workspaceId: string, _changedIds: ReadonlyArray<string> = [], tx?: EntityManager): Promise<void> {
        // Inside a job's finishing transaction the request is written in it (the state row and the pass's job commit with the job's own
        // writes) and a failure throws, so the job is retried; told after a plain write it is logged, the write already stands.
        if (tx !== undefined) return this.askedUnlessCooling(workspaceId, tx)
        try {
            await this.askedUnlessCooling(workspaceId)
        } catch (cause) {
            this.logger.error(PolicyDeriveLogEvent.RequestFailed, cause, { workspaceId })
        }
    }

    /** Asks for a pass unless one given up on its model is recent. */
    private async askedUnlessCooling(workspaceId: string, tx?: EntityManager): Promise<void> {
        const row = await (tx ?? this.entityManager).findOne(BrainPolicyDerivationEntity, { where: { workspaceId } })
        const cooling =
            row?.status === "failed" &&
            row.error === "model" &&
            this.clock.now().getTime() - row.updatedAt.getTime() < FAILED_COOLDOWN_MS
        if (cooling) return
        await this.request(workspaceId, tx)
    }

    /** The state of the workspace's pass, or null when none was ever asked for. */
    async state(workspaceId: string): Promise<MaybePolicyDerivationState> {
        const row = await this.entityManager.findOne(BrainPolicyDerivationEntity, { where: { workspaceId } })
        return row === null ? null : toState(row)
    }

    /**
     * Asks for a pass (in the caller's transaction when it hands one over: a job's finishing transaction). One that waits or runs (and is not lost) only learns the time of this request: a waiting pass has not read the
     * facts yet, a running one runs once more when it ends. Otherwise the state becomes `queued` and the job is written with it.
     */
    request(workspaceId: string, within?: EntityManager): Promise<PolicyDeriveRequested> {
        const ask = async (tx: EntityManager): Promise<PolicyDeriveRequested> => {
            const now = this.clock.now()
            const row = await tx.findOne(BrainPolicyDerivationEntity, { where: { workspaceId } })
            const since = row?.status === "running" ? (row.startedAt ?? row.requestedAt) : row?.requestedAt
            const pending =
                row !== null &&
                (row.status === "queued" || row.status === "running") &&
                since !== undefined &&
                now.getTime() - since.getTime() < STALE_MS
            if (pending) {
                await tx.update(BrainPolicyDerivationEntity, { workspaceId }, { requestedAt: now })
                return "pending"
            }
            await this.queued(tx, workspaceId, now)
            return "queued"
        }
        return within === undefined ? this.entityManager.transaction(ask) : ask(within)
    }

    /** The door of the tab (derive again, or retry after a failure): an owner or a manager asks for a pass of their workspace. */
    async requestFor(userId: string, workspaceId: string): Promise<PolicyDeriveRequested> {
        await this.members.require(userId, workspaceId, MANAGERS)
        return this.request(workspaceId)
    }

    /**
     * The backfill door: asks for a pass in every workspace that has facts in force and no derive state yet (a workspace that existed
     * before this layer), at most `limit` per call (a limit that is not a whole number reads as the maximum); answers how many were asked.
     * Safe to call again: a workspace asked once has a state. Its transport is the cli (`cli brain-policies backfill`).
     */
    async backfill(limit: number = BACKFILL_MAX): Promise<number> {
        const bound = Number.isInteger(limit) ? Math.max(1, Math.min(limit, BACKFILL_MAX)) : BACKFILL_MAX
        const rows: ReadonlyArray<{ readonly workspace_id: string }> = await this.entityManager
            .createQueryBuilder(BrainFactEntity, "f")
            .select("DISTINCT f.workspace_id", "workspace_id")
            .where("f.status = 'active'")
            .andWhere(
                `NOT EXISTS (SELECT 1 FROM public.brain_policy_derivations d WHERE d.workspace_id = f.workspace_id)`,
            )
            .limit(bound)
            .getRawMany()
        await eachInOrder(rows, (row) => this.factsChanged(row.workspace_id))
        this.logger.info(PolicyDeriveLogEvent.Backfilled, { workspaces: rows.length })
        return rows.length
    }

    /**
     * The cli's backfill (`cli brain-policies backfill [--limit <n>]`): the flag as typed (absent = the maximum), then one line on `out`
     * saying how many passes were queued; answers that count.
     */
    async backfillFor(out: PolicyBackfillOutput, limit?: string): Promise<number> {
        const queued = await this.backfill(limit === undefined ? BACKFILL_MAX : Number.parseInt(limit, 10))
        out.write(`queued ${String(queued)} workspace policy derive pass(es)
`)
        return queued
    }

    /** A pass starts: the state is `running` from now (a state the dead letter left as `failed` is taken up again here); answers when it started. */
    async started(workspaceId: string): Promise<PolicyPassStart> {
        const startedAt = this.clock.now()
        await this.entityManager.upsert(
            BrainPolicyDerivationEntity,
            { workspaceId, status: "running", startedAt, error: null },
            ["workspaceId"],
        )
        return { startedAt }
    }

    /**
     * A pass left nothing to judge: the state is `idle`, unless a change asked for a pass after this one started; then one more
     * pass is queued (it read the facts before that change).
     */
    finished(workspaceId: string, startedAt: Date): Promise<PolicyPassEnd> {
        return this.entityManager.transaction(async (tx) => {
            const row = await tx.findOne(BrainPolicyDerivationEntity, { where: { workspaceId } })
            if (row !== null && row.requestedAt.getTime() > startedAt.getTime()) {
                await this.queued(tx, workspaceId, this.clock.now(), row.requestedAt)
                return "queued"
            }
            await tx.update(
                BrainPolicyDerivationEntity,
                { workspaceId },
                { status: "idle", derivedAt: this.clock.now(), error: null },
            )
            return "idle"
        })
    }

    /** A pass reached its bound with facts left to judge: the next pass is queued. */
    async more(workspaceId: string): Promise<void> {
        await this.entityManager.transaction((tx) => this.queued(tx, workspaceId, this.clock.now()))
    }

    /**
     * A pass is WAITING for credits (a business wait, not a failure): the tab shows it, and NIVO tells the founder in /chat with its
     * common "background work stopped" card, ONCE per episode. The episode is the last pass that ENDED WELL (`derivedAt`; never one: one
     * episode): every wait until a pass succeeds again is the same episode (D-BR-2 (e)). Only the api composes the team chat; without it
     * (mcp, cli: they never run a pass) nothing is posted.
     */
    async waitingForCredits(workspaceId: string): Promise<void> {
        await this.entityManager.update(BrainPolicyDerivationEntity, { workspaceId }, { status: "failed", error: "credits" })
        if (this.notices === undefined) return
        const row = await this.entityManager.findOne(BrainPolicyDerivationEntity, { where: { workspaceId } })
        if (row === null) return
        const posted = await this.notices.postBackgroundStopped(workspaceId, {
            work: "brain.policies.derive",
            reason: "credits",
            episode: row.derivedAt ?? NEVER_DERIVED,
        })
        this.logger.info(PolicyDeriveLogEvent.StopReported, { workspaceId, reason: "credits", posted })
    }

    /**
     * The derive job was dead-lettered: the state is `failed` (cause `model`), so the tab shows it and a change of the facts does not ask
     * again for a while (`FAILED_COOLDOWN_MS`; the tab's door always does). The ONE item for a person is the runner's, not posted here.
     */
    async stopped(workspaceId: string): Promise<void> {
        await this.entityManager.update(BrainPolicyDerivationEntity, { workspaceId }, { status: "failed", error: "model" })
    }

    /** Writes the state `queued` and its job in one transaction; `requestedAt` keeps the time of the change that asked. */
    private async queued(tx: EntityManager, workspaceId: string, now: Date, requestedAt: Date = now): Promise<void> {
        await tx.upsert(
            BrainPolicyDerivationEntity,
            { workspaceId, status: "queued", requestedAt, error: null },
            ["workspaceId"],
        )
        await this.queue.enqueuePolicyDerive({ workspaceId }, tx, now.getTime())
    }
}
