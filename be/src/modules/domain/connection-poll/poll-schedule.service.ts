import { InjectClock, type Clock } from "@modules/platform/clock"
import { Injectable } from "@nestjs/common"
import { In, type EntityManager } from "typeorm"
import { callDbFunction, InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectConnectionPollOptions } from "./connection-poll.decorators"
import { ConnectionPollScheduleEntity } from "./persistence/entities"
import type { PollPlan } from "./poll-schedule.policy"
import type { ConnectionPollOptions } from "./connection-poll.options"
import type { PollHotReason, PollScheduleRow } from "./poll-schedule.contracts"

/** A connection that is due, with the instant it was due at (the scheduler's lag is how far past that the poll starts). */
export interface DueConnection {
    /** The schedule row as it was claimed. */
    readonly row: PollScheduleRow
    /** When the poll was planned for. */
    readonly dueAt: Date
}

const rowOf = (entity: ConnectionPollScheduleEntity): PollScheduleRow => ({
    connectionId: entity.connectionId,
    workspaceId: entity.workspaceId,
    provider: entity.provider,
    intervalMs: entity.intervalMs,
    failures: entity.failures,
    breakerState: entity.breakerState,
    breakerOpenedAt: entity.breakerOpenedAt,
    needsReauth: entity.needsReauth,
    hotUntil: entity.hotUntil,
    unavailableReason: entity.unavailableReason,
    lastSuccessAt: entity.lastSuccessAt,
    lastWebhookAt: entity.lastWebhookAt,
    backfillTo: entity.backfillTo,
    backfillNewest: entity.backfillNewest,
})

@Injectable()
/**
 * The only writer of public.connection_poll_schedule: which connections are due, what each poll planned next, and the signals other modules give
 * (a connection that became ready or has demand is hot; the webhook delivered). Claiming uses FOR UPDATE SKIP LOCKED, so replicas never take the same
 * connection, and a lease frees a connection whose worker died.
 */
export class PollScheduleService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectConnectionPollOptions() private readonly options: ConnectionPollOptions,
        @InjectClock() private readonly clock: Clock,
    ) {}

    /** Gives every connection of the providers a row in the schedule. */
    async enroll(providers: ReadonlyArray<string>): Promise<void> {
        await callDbFunction(this.entityManager, "public.connection_poll_enroll", [
            [...providers],
            this.options.schedule.healthyIntervalMs,
        ])
    }

    /**
     * Claims up to `size` due connections of the providers, oldest first, and holds them for the lease. A REMOVED connection (owner ruling R36:
     * `connections.deleted_at` set) keeps its schedule row but is never claimed.
     */
    claimDue(providers: ReadonlyArray<string>, size: number): Promise<ReadonlyArray<DueConnection>> {
        return this.entityManager.transaction(async (tx) => {
            const due = await tx
                .createQueryBuilder(ConnectionPollScheduleEntity, "s")
                .where(
                    "s.provider IN (:...providers) AND s.needs_reauth = false AND s.next_poll_at <= now() " +
                        "AND EXISTS (SELECT 1 FROM public.connections c WHERE c.id = s.connection_id AND c.deleted_at IS NULL)",
                    {
                        providers: [...providers],
                    },
                )
                .orderBy("s.next_poll_at")
                .limit(size)
                .setLock("pessimistic_write")
                .setOnLocked("skip_locked")
                .getMany()
            if (due.length === 0) return []
            await tx.update(
                ConnectionPollScheduleEntity,
                { connectionId: In(due.map((entity) => entity.connectionId)) },
                { nextPollAt: () => `now() + make_interval(secs => ${this.options.schedule.leaseMs / 1000})` },
            )
            return due.map((entity) => ({ row: rowOf(entity), dueAt: entity.nextPollAt }))
        })
    }

    /** Writes what a finished poll planned. */
    async settle(connectionId: string, plan: PollPlan): Promise<void> {
        await this.entityManager.update(
            ConnectionPollScheduleEntity,
            { connectionId },
            {
                nextPollAt: new Date(plan.nextPollAt),
                intervalMs: plan.intervalMs,
                failures: plan.failures,
                breakerState: plan.breakerState,
                breakerOpenedAt: plan.breakerOpenedAt === null ? null : new Date(plan.breakerOpenedAt),
                needsReauth: plan.needsReauth,
                unavailableReason: plan.unavailableReason,
                backfillTo: plan.backfillTo === null ? null : new Date(plan.backfillTo),
                backfillNewest: plan.backfillNewest === null ? null : new Date(plan.backfillNewest),
                ...(plan.succeeded ? { lastSuccessAt: () => "now()" } : {}),
            },
        )
    }

    /** Plans the connection again at `nextPollAt` without counting a poll. */
    async defer(connectionId: string, nextPollAt: Date): Promise<void> {
        await this.entityManager.update(ConnectionPollScheduleEntity, { connectionId }, { nextPollAt })
    }

    /**
     * Makes the connection hot: it is polled at the hot interval until the time to live runs out, and its next poll is brought forward. Other modules
     * call this when a connection has demand (an order awaiting payment, an open payment claim). A connection that is not in the schedule yet joins it.
     */
    async markHot(
        connectionId: string,
        reason: PollHotReason,
        ttlMs: number = this.options.schedule.hotTtlMs,
        within: EntityManager = this.entityManager,
    ): Promise<void> {
        await callDbFunction(within, "public.connection_poll_mark_hot", [
            connectionId,
            this.options.schedule.hotIntervalMs,
            ttlMs,
            reason,
        ])
    }

    /**
     * The connection can be read back now (its credential was just saved, or the owner says the provider plan was upgraded): the breaker, the owner
     * request and the unavailable capability are cleared and it is polled hot. `within` is the transaction of the job write that asks for the
     * poll: the readiness and the job commit together.
     */
    async markReady(connectionId: string, within: EntityManager = this.entityManager): Promise<void> {
        await within.update(
            ConnectionPollScheduleEntity,
            { connectionId },
            { failures: 0, breakerState: "closed", breakerOpenedAt: null, needsReauth: false, unavailableReason: null },
        )
        await this.markHot(connectionId, "connection_ready", this.options.schedule.hotTtlMs, within)
    }

    /**
     * The webhook of the provider delivered for this connection: it is healthy, so the interval may be long. A delivery after a silence longer
     * than the declared webhook silence (or the first one ever) is a detectable GAP: events may have been missed meanwhile, so the account is
     * polled hot at once (owner R95: the poll brings back what the webhook lost).
     */
    async recordWebhook(connection: string): Promise<void> {
        const held = await this.entityManager.findOne(ConnectionPollScheduleEntity, {
            where: { connectionId: connection },
            select: { connectionId: true, lastWebhookAt: true },
        })
        await this.entityManager.update(ConnectionPollScheduleEntity, { connectionId: connection }, { lastWebhookAt: () => "now()" })
        if (held === null) return
        const silentSince = held.lastWebhookAt?.getTime() ?? null
        if (silentSince === null || this.clock.now().getTime() - silentSince > this.options.schedule.webhookSilentAfterMs) {
            await this.markHot(connection, "webhook_gap")
        }
    }

    /**
     * THE PASS AT PROCESS START (owner R95): every scheduled account that is not waiting for its owner is due now, so the first ticks after a
     * downtime read back what the webhooks lost meanwhile (fair across workspaces, under each provider's limits, as every tick).
     */
    async dueNow(): Promise<void> {
        await this.entityManager
            .createQueryBuilder()
            .update(ConnectionPollScheduleEntity)
            .set({ nextPollAt: () => "now()" })
            .where("needs_reauth = false AND next_poll_at > now()")
            .execute()
    }
}
