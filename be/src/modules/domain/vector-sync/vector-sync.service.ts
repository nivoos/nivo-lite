import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import {
    InjectVectorIndex,
    type VectorIndex,
    type VectorKind,
    type VectorPoint,
    type VectorRow,
    type VectorRowSource,
    type VectorStamp,
} from "@modules/integrations/qdrant"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { InjectEffects, onceAnswered, type Effects } from "@modules/platform/effects"
import type { ClaimedJob } from "@modules/platform/jobs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import {
    VECTOR_EMBED_EFFECT,
    VECTOR_SYNC_IDS_MAX,
    VECTOR_WRITE_EFFECT,
    VectorSyncQueue,
    isVectorSyncPayload,
} from "@modules/queues/vector-sync"
import { VectorSyncError, VectorSyncErrorCode } from "./errors/vector-sync.error"
import {
    NOTHING_SYNCED,
    type VectorEmbedder,
    type VectorSyncDone,
    type VectorSyncMeans,
    type VectorsEmbedded,
} from "./vector-sync.contracts"
import { InjectVectorEmbedder, InjectVectorRowSources, type VectorRowSources } from "./vector-sync.decorators"
import { VectorSyncLogEvent } from "./vector-sync.log-events"
import {
    SYNC_EMBED_BATCH,
    RECONCILE_PAGE,
    SYNC_EMBED_CALLS,
    addDone,
    batchesOf,
    byFlags,
    byWorkspace,
    noneDone,
    orphansOf,
    payloadOfRow,
    planOf,
} from "./vector-sync.policy"

/** Where the vector of a row that needs one came from. */
type VectorOrigin = "given" | "adopted" | "embedded"

/** A vector with where it came from. */
interface VectorVector {
    /** The vector. */
    readonly vector: ReadonlyArray<number>
    /** Where it came from. */
    readonly origin: VectorOrigin
}

/** What finding the vectors left over: the rows left without for no fault, and the embedding calls made. */
interface VectorsFound {
    /** Rows left without for no fault: no credits, embeddings not configured, or the embedding budget of this sync is spent. */
    readonly waiting: number
    /** How many embedding calls were made. */
    readonly calls: number
}

@Injectable()
/**
 * Keeps the vector index in step with Postgres, ONE WAY: Postgres is the system of record, a point is the projection of one row (the
 * point id is the row id), and nothing is ever read back from the index into a row except "the index accepted it" (`indexed_at`).
 *
 * A change reaches the index in two moves, in this order. First the writer commits its rows together with a `vector.sync` job naming
 * them (`VectorSyncQueue.enqueueSync`, or `accept` here when the writer holds fresh vectors). Then the index follows: the job (and
 * `accept`, right after its commit, with the vectors in hand) reads the rows again, compares them with the points the index holds
 * (`planOf`: row id + text hash + model + flags) and writes only the difference. So a replayed job, a job that arrives after the
 * fast path, and the reconcile that walks every row all converge on the same points and write nothing twice.
 *
 * THE RULE (engine words): a vector index is a required engine piece; a row kind declares that it is embedded (its `VectorRowSource`);
 * the index holds the only vector of each such row; a search is an index query with the mandatory filters (the tenant, the row's
 * kind, the reader's scope), then the rows from Postgres by id. There is no other store and no switch.
 *
 * A row that needs a vector gets it, in this order: from the caller (the embedding it just paid for), from the point of another row
 * of the same text (adoption: one index read, no embedding call, nothing booked), and only then from an embedding call, credit-checked
 * and booked to the workspace (the platform's own rows are not metered). A row that stays without (no credits, embeddings not
 * configured) waits and is found by words meanwhile.
 */
export class VectorSyncService {
    constructor(
        @InjectVectorIndex() private readonly index: VectorIndex,
        @InjectVectorRowSources() private readonly sources: VectorRowSources,
        @InjectVectorEmbedder() private readonly embedder: VectorEmbedder,
        private readonly queue: VectorSyncQueue,
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectLogger() private readonly logger: Logger,
        @InjectClock() private readonly clock: Clock,
        @InjectEffects() private readonly effects: Effects,
    ) {}

    /**
     * The `vector.sync` job: brings the points of the rows a change named in step with the rows. A failure of the index or of an
     * embedding call is thrown: the runner retries the job on its ladder and dead-letters it with one item when the cause stays. The
     * points written and the rows stamped before the failure stay, so a retry or a resume does only what is left (the plan skips every
     * row whose point is current).
     */
    async sync(job: ClaimedJob): Promise<VectorSyncDone> {
        const payload = job.payload
        if (!isVectorSyncPayload(payload)) throw new VectorSyncError({ code: VectorSyncErrorCode.PayloadInvalid })
        const means: VectorSyncMeans = { embedCalls: SYNC_EMBED_CALLS, job }
        const done =
            payload.sourceId === undefined
                ? await this.syncRows(this.index, payload.kind, payload.workspaceId, payload.ids ?? [], means)
                : await this.syncSource(this.index, payload.workspaceId, payload.sourceId, means)
        this.logger.info(VectorSyncLogEvent.Synced, { kind: payload.kind, workspaceId: payload.workspaceId, ...done })
        return done
    }

    /**
     * Rows of one workspace changed (a truth put in force, superseded, retired, expired, switched to another reach; passages whose
     * flags changed): their `vector.sync` job is written, in the caller's transaction when it hands one over (the job then exists
     * exactly when the change does), else in one of its own right after the caller's commit.
     */
    async changed(kind: VectorKind, workspaceId: string, ids: ReadonlyArray<string>, tx?: EntityManager): Promise<void> {
        const unique = [...new Set(ids)]
        if (unique.length === 0) return
        const at = this.clock.now().getTime()
        const write = async (manager: EntityManager): Promise<void> => {
            await eachInOrder(batchesOf(unique, VECTOR_SYNC_IDS_MAX), (batch) =>
                this.queue.enqueueSync({ kind, workspaceId, ids: batch, at }, manager),
            )
        }
        await (tx === undefined ? this.entityManager.transaction(write) : write(tx))
    }

    /**
     * One document changed (indexed, read again, replaced, deleted, its readers or its release to customers changed): the job that
     * brings every passage of it, and every point the index still holds for it, in step. In the caller's transaction when it hands
     * one over.
     */
    async changedSource(workspaceId: string, sourceId: string, tx?: EntityManager): Promise<void> {
        const payload = { kind: "passage" as const, workspaceId, sourceId, at: this.clock.now().getTime() }
        await (tx === undefined
            ? this.entityManager.transaction((manager) => this.queue.enqueueSync(payload, manager))
            : this.queue.enqueueSync(payload, tx))
    }

    /**
     * A writer hands over the vectors it just made for rows it has already committed: the `vector.sync` job of those rows is written
     * first (its own transaction: the durable promise), then the points are written with the vectors in hand and Postgres records
     * that the index accepted them. When the index does not answer this THROWS (the writer's job is retried on its ladder); nothing is
     * lost but the vectors: the job queued first brings the rows in step (adopting or embedding again).
     */
    async accept(
        kind: VectorKind,
        workspaceId: string,
        vectors: ReadonlyMap<string, ReadonlyArray<number>>,
    ): Promise<VectorSyncDone> {
        const ids = [...vectors.keys()]
        if (ids.length === 0) return NOTHING_SYNCED
        await this.changed(kind, workspaceId, ids)
        return this.syncRows(this.index, kind, workspaceId, ids, { given: vectors, embedCalls: 0 })
    }

    /**
     * Gives the rows among these that have no current point the vector of another row's point of the same text, with NO embedding
     * call: answers the ids that now have a current point. The others still need an embedding. When the index does not answer this
     * throws: the caller's job is retried.
     */
    async adopt(kind: VectorKind, workspaceId: string, ids: ReadonlyArray<string>): Promise<ReadonlySet<string>> {
        if (ids.length === 0) return new Set()
        const index = this.index
        const rows = await this.sources[kind].byIds(workspaceId, ids)
        const stamps = await index.stampsOf(
            kind,
            rows.map((row) => row.id),
        )
        return (await this.settleRows(index, kind, rows, stamps, { embedCalls: 0 })).current
    }

    /**
     * Brings these rows of one workspace in step with their points; an id with no row any more loses its point. Used by the job, by
     * `accept`, and by nothing that holds a request open.
     */
    private async syncRows(
        index: VectorIndex,
        kind: VectorKind,
        workspaceId: string,
        ids: ReadonlyArray<string>,
        means: VectorSyncMeans,
    ): Promise<VectorSyncDone> {
        const unique = [...new Set(ids)]
        const rows = await this.sources[kind].byIds(workspaceId, unique)
        const stamps = await index.stampsOf(kind, unique)
        const settled = await this.settle(index, kind, rows, stamps, means)
        const known = new Set(rows.map((row) => row.id))
        const gone = stamps.filter((stamp) => !known.has(stamp.id) && stamp.payload.workspaceId === workspaceId).map((stamp) => stamp.id)
        if (gone.length > 0) await this.removePoints(index, kind, workspaceId, gone, means.job)
        return addDone(settled, { removed: gone.length })
    }

    /**
     * Brings one document's passages in step with its points, both ways: every row of the document is settled, and every point the
     * index still holds for the document whose row is gone is removed (a deleted document has no rows: all its points go).
     */
    private async syncSource(
        index: VectorIndex,
        workspaceId: string,
        sourceId: string,
        means: VectorSyncMeans,
    ): Promise<VectorSyncDone> {
        const rows = await this.sources.passage.ofSource(workspaceId, sourceId)
        const held = await this.stampsOfSource(index, workspaceId, sourceId)
        const settled = await this.settle(index, "passage", rows, held, means)
        const orphans = orphansOf(held, new Set(rows.map((row) => row.id))).get(workspaceId) ?? []
        if (orphans.length > 0) await this.removePoints(index, "passage", workspaceId, orphans, means.job)
        return addDone(settled, { removed: orphans.length })
    }

    /**
     * Removes points from the index: an outside write, idempotent by point id (a removal made again removes nothing more), so it is
     * declared `repeatable` and keyed by the job and its first point; without a job (a writer's own fast path) it is made plainly.
     */
    removePoints(
        index: VectorIndex,
        kind: VectorKind,
        workspaceId: string,
        ids: ReadonlyArray<string>,
        job?: ClaimedJob,
    ): Promise<void> {
        const act = (): Promise<void> => index.remove(kind, workspaceId, ids)
        if (job === undefined) return act()
        return this.effects.once(`${job.jobId}:remove:${kind}:${ids[0] ?? ""}`, VECTOR_WRITE_EFFECT, { act })
    }

    /** Every point the index holds for one document, page by page. */
    private async stampsOfSource(
        index: VectorIndex,
        workspaceId: string,
        sourceId: string,
        after: string | null = null,
    ): Promise<ReadonlyArray<VectorStamp>> {
        const page = await index.stamps("passage", { workspaceId, sourceId }, { limit: RECONCILE_PAGE, after })
        if (page.next === null) return page.points
        return [...page.points, ...(await this.stampsOfSource(index, workspaceId, sourceId, page.next))]
    }

    /**
     * THE one place rows become points: plans the difference between rows and the points held for them, then removes, rewrites flags,
     * finds a vector for each row that needs one, writes those points, and records in Postgres what the index accepted. Postgres is
     * stamped only AFTER the index acknowledged the write, so `indexed_at` never runs ahead of the index.
     */
    async settle(
        index: VectorIndex,
        kind: VectorKind,
        rows: ReadonlyArray<VectorRow>,
        stamps: ReadonlyArray<VectorStamp>,
        means: VectorSyncMeans,
    ): Promise<VectorSyncDone> {
        return (await this.settleRows(index, kind, rows, stamps, means)).done
    }

    /** The work of `settle`, with the ids of the rows that hold a current point when it ends. */
    private async settleRows(
        index: VectorIndex,
        kind: VectorKind,
        rows: ReadonlyArray<VectorRow>,
        stamps: ReadonlyArray<VectorStamp>,
        means: VectorSyncMeans,
    ): Promise<{ readonly done: VectorSyncDone; readonly current: ReadonlySet<string> }> {
        if (rows.length === 0) return { done: noneDone(), current: new Set() }
        const source = this.sources[kind]
        const model = this.embedder.model()
        const plan = planOf(rows, stamps, model)
        await eachInOrder(byWorkspace(plan.removals), ([workspaceId, gone]) =>
            this.removePoints(index, kind, workspaceId, gone.map((row) => row.id), means.job),
        )
        await eachInOrder(byFlags(plan.marks), (group) => index.mark(kind, group.flags.workspaceId, group.ids, group.flags))
        // Each batch of rows with a vector is written and stamped as soon as it has its vector, so a failure later in the sync (the
        // index down, an embedding call failing) keeps what earlier batches did, and a retry plans over what is left.
        const written: Array<VectorRow> = []
        const origins: Array<VectorOrigin> = []
        const commit = async (batch: ReadonlyArray<VectorRow>, vectors: ReadonlyMap<string, VectorVector>): Promise<void> => {
            const points = batch.flatMap((row): ReadonlyArray<VectorPoint> => {
                const vector = vectors.get(row.id)?.vector
                return vector === undefined ? [] : [{ id: row.id, vector, payload: payloadOfRow(row, model) }]
            })
            const act = (): Promise<void> => index.upsert(kind, points)
            if (means.job === undefined) await act()
            else await this.effects.once(`${means.job.jobId}:upsert:${kind}:${batch[0]?.id ?? ""}`, VECTOR_WRITE_EFFECT, { act })
            await eachInOrder(byWorkspace(batch), ([workspaceId, accepted]) =>
                source.stamp(workspaceId, accepted.map((row) => ({ id: row.id, textHash: row.textHash })), model),
            )
            written.push(...batch.filter((row) => vectors.has(row.id)))
            origins.push(...batch.flatMap((row) => vectors.get(row.id)?.origin ?? []))
        }
        const found = await this.vectorsOf(index, kind, source, plan.needs, model, means, commit)
        await eachInOrder(byWorkspace([...plan.unstamped, ...plan.marks]), ([workspaceId, accepted]) =>
            source.stamp(workspaceId, accepted.map((row) => ({ id: row.id, textHash: row.textHash })), model),
        )
        const count = (origin: VectorOrigin): number => origins.filter((one) => one === origin).length
        return {
            done: {
                unchanged: plan.settled.length + plan.unstamped.length,
                given: count("given"),
                adopted: count("adopted"),
                embedded: count("embedded"),
                marked: plan.marks.length,
                removed: plan.removals.length,
                waiting: found.waiting,
                embedCalls: found.calls,
            },
            current: new Set([...plan.settled, ...plan.unstamped, ...plan.marks, ...written].map((row) => row.id)),
        }
    }

    /**
     * A vector for each row that needs one, cheapest first: the caller's, another row's point of the same text, then an embedding call
     * per `SYNC_EMBED_BATCH` rows of one tenant, inside the budget of calls. Every batch is handed to `commit` (written, stamped) as
     * soon as it has its vectors. A call that answers nothing usable THROWS: the sync stops there and the runner retries it.
     */
    private async vectorsOf(
        index: VectorIndex,
        kind: VectorKind,
        source: VectorRowSource,
        needs: ReadonlyArray<VectorRow>,
        model: string,
        means: VectorSyncMeans,
        commit: (batch: ReadonlyArray<VectorRow>, vectors: ReadonlyMap<string, VectorVector>) => Promise<void>,
    ): Promise<VectorsFound> {
        const run = { waiting: 0, calls: 0 }
        const given = needs.filter((row) => means.given?.has(row.id) === true)
        if (given.length > 0) {
            await commit(
                given,
                new Map(given.map((row) => [row.id, { vector: means.given?.get(row.id) ?? [], origin: "given" as const }])),
            )
        }
        await eachInOrder(byWorkspace(needs.filter((row) => means.given?.has(row.id) !== true)), async ([workspaceId, rest]) => {
            const donors = await source.donors(
                workspaceId,
                [...new Set(rest.map((row) => row.textHash))],
                model,
                rest.map((row) => row.id),
            )
            const lent = donors.size === 0 ? new Map<string, ReadonlyArray<number>>() : await index.vectorsOf(kind, workspaceId, [...new Set(donors.values())])
            const adopted = new Map<string, VectorVector>()
            for (const row of rest) {
                const vector = lent.get(donors.get(row.textHash) ?? "")
                if (vector !== undefined) adopted.set(row.id, { vector, origin: "adopted" })
            }
            if (adopted.size > 0) await commit(rest.filter((row) => adopted.has(row.id)), adopted)
            await eachInOrder(
                batchesOf(rest.filter((row) => !adopted.has(row.id)), SYNC_EMBED_BATCH),
                async (batch) => {
                    if (run.calls >= means.embedCalls || !this.embedder.configured()) {
                        run.waiting += batch.length
                        return
                    }
                    run.calls += 1
                    const act = (): Promise<VectorsEmbedded> => this.embedder.embed(workspaceId, batch.map((row) => row.text))
                    // The vectors are too large for the ledger: the points written and stamped below ARE the result of this act.
                    const answer =
                        means.job === undefined
                            ? await act()
                            : await onceAnswered(this.effects, `${means.job.jobId}:embed:${kind}:${batch[0]?.id ?? ""}`, VECTOR_EMBED_EFFECT, act)
                    if (answer.kind === "blocked") {
                        run.waiting += batch.length
                        return
                    }
                    if (answer.kind === "failed" || answer.vectors.length !== batch.length) {
                        throw new VectorSyncError({ code: VectorSyncErrorCode.EmbeddingUnavailable })
                    }
                    await commit(
                        batch,
                        new Map(batch.map((row, at) => [row.id, { vector: answer.vectors[at] ?? [], origin: "embedded" as const }])),
                    )
                },
            )
        })
        return run
    }
}
