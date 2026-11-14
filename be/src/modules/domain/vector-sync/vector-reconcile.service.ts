import { Injectable } from "@nestjs/common"
import { In, type EntityManager } from "typeorm"
import {
    InjectVectorIndex,
    InjectVectorIndexBoot,
    VECTOR_KINDS,
    type VectorIndex,
    type VectorIndexBoot,
    type VectorKind,
} from "@modules/integrations/qdrant"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectEffects, type Effects } from "@modules/platform/effects"
import type { ClaimedJob } from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import { VECTOR_WRITE_EFFECT, VectorSyncQueue } from "@modules/queues/vector-sync"
import { VectorSyncStateEntity } from "./persistence/entities"
import { VectorSyncError, VectorSyncErrorCode } from "./errors/vector-sync.error"
import type { VectorReconcileDone, VectorReconcileKindDone, VectorSyncDone } from "./vector-sync.contracts"
import { InjectVectorRowSources, type VectorRowSources } from "./vector-sync.decorators"
import { VectorSyncLogEvent } from "./vector-sync.log-events"
import {
    RECONCILE_EMBED_CALLS,
    RECONCILE_PAGE,
    RECONCILE_POINTS_PER_RUN,
    RECONCILE_ROWS_PER_RUN,
    addDone,
    noneDone,
    orphansOf,
    repairedSomething,
} from "./vector-sync.policy"
import { VectorSyncService } from "./vector-sync.service"

/** Where the walks of one kind stand between two runs. */
interface Cursors {
    /** The last row id compared; null = from the first row. */
    readonly rowsAfter: string | null
    /** The index's page cursor of the walk over its points; null = from the first point. */
    readonly pointsAfter: string | null
}

/** What one run did for one kind, with where its walks stopped. */
interface KindRun {
    /** The counts. */
    readonly done: VectorReconcileKindDone
    /** Where the next run goes on. */
    readonly cursors: Cursors
}

/** The state one kind's two walks share while a run goes on. */
interface WalkState {
    /** The counts so far. */
    done: VectorSyncDone
    /** Rows compared so far. */
    rows: number
    /** Points compared so far. */
    points: number
    /** The row cursor. */
    rowsAfter: string | null
    /** The point cursor. */
    pointsAfter: string | null
    /** True when the rows walk reached the end. */
    rowsWrapped: boolean
    /** True when the points walk reached the end. */
    pointsWrapped: boolean
}

@Injectable()
/**
 * The reconcile of the vector index against Postgres: the safety net under the `vector.sync` jobs, and the REBUILD (an empty index
 * is only the largest drift). One run, per kind of point, walks two ways, each bounded and resumable from a stored cursor:
 * - rows → points: a page of Postgres rows in id order (the primary key), the points of those ids read from the index in one call,
 *   the difference settled exactly as a sync job would (`VectorSyncService.settle`): a row with no point, a point of another text,
 *   model or workspace, stale flags, a point of a row that must hold none;
 * - points → rows: a page of the index's points, the rows that still want one asked from Postgres in one statement, the points
 *   whose row is gone removed (a deleted document, a deleted workspace).
 * A run that repaired something and used its whole budget queues its own follow-up in the transaction that saves its cursors (a
 * rebuild runs back to back); a clean run waits for the next tick. A run that meets a failure of the index or of an embedding call THROWS:
 * the runner retries it on its ladder and dead-letters it with one item when the cause stays; the cursors of the last finished run stand,
 * and every page it settled again is a no-op (the plan skips a current point). Rows that wait for credits are not drift: they wait,
 * found by words meanwhile.
 */
export class VectorReconcileService {
    constructor(
        @InjectVectorIndex() private readonly index: VectorIndex,
        @InjectVectorIndexBoot() private readonly boot: VectorIndexBoot,
        @InjectVectorRowSources() private readonly sources: VectorRowSources,
        private readonly sync: VectorSyncService,
        private readonly queue: VectorSyncQueue,
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectLogger() private readonly logger: Logger,
        @InjectClock() private readonly clock: Clock,
        @InjectEffects() private readonly effects: Effects,
    ) {}

    /** One run: every kind, inside its budget. A failure of the index or of an embedding call is thrown, never counted. */
    async run(job: ClaimedJob): Promise<VectorReconcileDone> {
        const index = this.index
        await this.prepare(job)
        const kinds: Partial<Record<VectorKind, VectorReconcileKindDone>> = {}
        const cursors: Partial<Record<VectorKind, Cursors>> = {}
        const tally = { repaired: false, unfinished: false }
        const now = this.clock.now()
        const states = await this.entityManager.find(VectorSyncStateEntity, {
            where: { kind: In([...VECTOR_KINDS]) },
            take: VECTOR_KINDS.length,
        })
        await eachInOrder(VECTOR_KINDS, async (kind) => {
            const state = states.find((one) => one.kind === kind)
            const from: Cursors = { rowsAfter: state?.rowsAfter ?? null, pointsAfter: state?.pointsAfter ?? null }
            const ran = await this.walk(index, kind, from, job)
            cursors[kind] = ran.cursors
            kinds[kind] = ran.done
            tally.repaired ||= repairedSomething(ran.done)
            tally.unfinished ||= !ran.done.rowsWrapped
        })
        const continued = tally.repaired && tally.unfinished
        // The cursors of every kind and the follow-up job are one transaction: a run saved is a run whose follow-up exists.
        await this.entityManager.transaction(async (tx) => {
            await eachInOrder(VECTOR_KINDS, async (kind) => {
                const state = states.find((one) => one.kind === kind)
                const ran = cursors[kind]
                if (ran === undefined) return
                await tx.upsert(
                    VectorSyncStateEntity,
                    {
                        kind,
                        rowsAfter: ran.rowsAfter,
                        pointsAfter: ran.pointsAfter,
                        passes: (state?.passes ?? 0) + (kinds[kind]?.rowsWrapped === true ? 1 : 0),
                        lastRunAt: now,
                    },
                    ["kind"],
                )
            })
            if (continued) await this.queue.enqueueReconcile({ resumedAt: now.getTime() }, tx)
        })
        const done: VectorReconcileDone = { kinds, continued }
        this.logger.info(VectorSyncLogEvent.Reconciled, { ...done })
        return done
    }

    /**
     * Prepares the collections of the index: an outside ACT (it creates a missing collection), safe to repeat, so it goes through the
     * effects piece as a `repeatable` vector write. An index that could not be prepared throws inside the act, which releases its intent.
     */
    private prepare(job: ClaimedJob): Promise<void> {
        return this.effects.once(`${job.jobId}:prepare`, VECTOR_WRITE_EFFECT, {
            act: async () => {
                if (!(await this.boot.prepare())) throw new VectorSyncError({ code: VectorSyncErrorCode.IndexUnavailable })
            },
        })
    }

    /** The two walks of one kind; a failure of the index or of an embedding call is thrown. */
    private async walk(index: VectorIndex, kind: VectorKind, from: Cursors, job: ClaimedJob): Promise<KindRun> {
        const run: WalkState = {
            done: noneDone(),
            rows: 0,
            points: 0,
            rowsAfter: from.rowsAfter,
            pointsAfter: from.pointsAfter,
            rowsWrapped: false,
            pointsWrapped: false,
        }
        await this.walkRows(index, kind, run, RECONCILE_EMBED_CALLS, job)
        await this.walkPoints(index, kind, run, job)
        return {
            done: { ...run.done, rows: run.rows, points: run.points, rowsWrapped: run.rowsWrapped, pointsWrapped: run.pointsWrapped },
            cursors: { rowsAfter: run.rowsAfter, pointsAfter: run.pointsAfter },
        }
    }

    /** The rows to points walk: one page of rows per step, until the run's row budget is spent, a page fails, or the rows wrap. */
    private async walkRows(index: VectorIndex, kind: VectorKind, run: WalkState, embedLeft: number, job: ClaimedJob): Promise<void> {
        if (run.rows >= RECONCILE_ROWS_PER_RUN) return
        const page = await this.sources[kind].page(run.rowsAfter, RECONCILE_PAGE)
        if (page.length === 0) {
            run.rowsWrapped = true
            run.rowsAfter = null
            return
        }
        const stamps = await index.stampsOf(
            kind,
            page.map((row) => row.id),
        )
        const settled: VectorSyncDone = await this.sync.settle(index, kind, page, stamps, { embedCalls: embedLeft, job })
        run.done = addDone(run.done, settled)
        const left = embedLeft - settled.embedCalls
        // Rows left waiting because THIS run's embedding budget is spent: the page is met again by the next run.
        if (left <= 0 && settled.waiting > 0) return
        run.rows += page.length
        run.rowsAfter = page.at(-1)?.id ?? run.rowsAfter
        await this.walkRows(index, kind, run, left, job)
    }

    /** The points to rows walk: one page of the index's points per step, the points whose row is gone removed, until the budget is spent or the points wrap. */
    private async walkPoints(index: VectorIndex, kind: VectorKind, run: WalkState, job: ClaimedJob): Promise<void> {
        if (run.points >= RECONCILE_POINTS_PER_RUN) return
        const held = await index.stamps(kind, {}, { limit: RECONCILE_PAGE, after: run.pointsAfter })
        const wanted = await this.sources[kind].wantedAmong(held.points.map((point) => point.id))
        await eachInOrder(orphansOf(held.points, new Set(wanted.map((row) => row.id))), async ([workspaceId, ids]) => {
            await this.sync.removePoints(index, kind, workspaceId, ids, job)
            run.done = addDone(run.done, { removed: ids.length })
        })
        run.points += held.points.length
        run.pointsAfter = held.next
        if (held.next === null) {
            run.pointsWrapped = true
            return
        }
        await this.walkPoints(index, kind, run, job)
    }
}
