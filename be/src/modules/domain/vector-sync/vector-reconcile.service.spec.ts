import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { InsertResult } from "typeorm"
import { PLATFORM_TENANT, type VectorIndexBoot } from "@modules/integrations/qdrant"
import type { Logger } from "@modules/platform/logging"
import { classifyFailure } from "@modules/platform/queue"
import { VectorSyncQueue } from "@modules/queues/vector-sync"
import { FakeEmbedder, FakeRowSource, FakeVectorIndex, TEST_MODEL, vectorRowOf } from "@tests/fixtures/builders/vector-sync.builder"
import { VectorSyncStateEntity } from "./persistence/entities"
import { chainProviders, claimedJob } from "@tests/fixtures/builders/knowledge-chain.builder"
import { VectorSyncErrorCode } from "./errors/vector-sync.error"
import { VectorReconcileService } from "./vector-reconcile.service"
import { VectorSyncService } from "./vector-sync.service"

const WS = "11111111-1111-4111-8111-111111111111"
const JOB = claimedJob({})
const WS2 = "22222222-2222-4222-8222-222222222222"
const NOW = new Date("2026-11-11T10:00:00.000Z")

/** A row id that sorts by its number. */
const idOf = (at: number): string => `row-${String(at).padStart(7, "0")}`

const build = () => {
    const index = new FakeVectorIndex()
    const sources = { passage: new FakeRowSource(), truth: new FakeRowSource(), base: new FakeRowSource() }
    const embedder = new FakeEmbedder()
    const queue = mock<VectorSyncQueue>()
    const logger = mock<Logger>()
    const chain = chainProviders()
    const boot = mock<VectorIndexBoot>()
    boot.prepare.mockImplementation(() => Promise.resolve(!index.down))
    const states = new Map<string, VectorSyncStateEntity>()
    const em = mockEntityManager()
    fakeTransaction(em)
    em.find.mockImplementation(() => Promise.resolve([...states.values()]))
    em.upsert.mockImplementation((_entity, row) => {
        const state = Object.assign(new VectorSyncStateEntity(), row)
        states.set(String(state.kind), state)
        return Promise.resolve(new InsertResult())
    })
    const clock = new FakeClock(NOW)
    const sync = new VectorSyncService(index, sources, embedder, queue, em, logger, clock, chain.ledger.effects)
    const reconcile = new VectorReconcileService(index, boot, sources, sync, queue, em, logger, clock, chain.ledger.effects)
    return { reconcile, index, sources, embedder, queue, logger, states, boot, chain }
}

/** Runs the reconcile until a run neither repairs nor is left unfinished; answers how many runs it took. */
const settle = async (reconcile: VectorReconcileService, most = 400): Promise<number> => {
    let runs = 0
    let continued = true
    while (continued && runs < most) {
        runs += 1
        continued = (await reconcile.run(JOB)).continued
    }
    expect(continued).toBe(false)
    return runs
}

const registerDriftCases = () => {
    it("repairs every kind of drift in one run: no point, stale text, stale model, stale flags, a point a row must not hold, a point with no row", async () => {
        const { reconcile, index, sources, embedder } = build()
        const rows = sources.truth
        rows.put(
            vectorRowOf("a-missing", WS),
            vectorRowOf("b-stale-text", WS),
            vectorRowOf("c-stale-model", WS),
            vectorRowOf("d-stale-flags", WS, { mirror: { ...vectorRowOf("x", WS).mirror, isPublic: true, customerReady: true } }),
            vectorRowOf("e-retired", WS, { wanted: false }),
            vectorRowOf("f-fine", WS, { stamped: true, stampedModel: TEST_MODEL }),
        )
        const payload = (id: string) => ({ ...vectorRowOf(id, WS).mirror, model: TEST_MODEL, textHash: `hash-${id}` })
        index.points.truth.set("b-stale-text", { id: "b-stale-text", vector: [1], payload: { ...payload("b-stale-text"), textHash: "old" } })
        index.points.truth.set("c-stale-model", { id: "c-stale-model", vector: [1], payload: { ...payload("c-stale-model"), model: "old@1536" } })
        index.points.truth.set("d-stale-flags", { id: "d-stale-flags", vector: [4], payload: payload("d-stale-flags") })
        index.points.truth.set("e-retired", { id: "e-retired", vector: [5], payload: payload("e-retired") })
        index.points.truth.set("f-fine", { id: "f-fine", vector: [6], payload: payload("f-fine") })
        index.points.truth.set("g-orphan", { id: "g-orphan", vector: [7], payload: payload("g-orphan") })

        const done = await reconcile.run(JOB)

        expect(done.kinds.truth).toMatchObject({ rows: 6, embedded: 3, marked: 1, removed: 2, unchanged: 1, rowsWrapped: true, pointsWrapped: true })
        expect([...index.points.truth.keys()].toSorted()).toEqual(["a-missing", "b-stale-text", "c-stale-model", "d-stale-flags", "f-fine"])
        expect(index.payloadOf("truth", "b-stale-text")?.textHash).toBe("hash-b-stale-text")
        expect(index.payloadOf("truth", "c-stale-model")?.model).toBe(TEST_MODEL)
        expect(index.payloadOf("truth", "d-stale-flags")).toMatchObject({ isPublic: true, customerReady: true })
        expect(index.points.truth.get("d-stale-flags")?.vector).toEqual([4])
        expect(embedder.calls).toBe(1)

        // The next run meets a clean index: it compares and writes nothing.
        const upserts = index.calls.upsert
        const again = await reconcile.run(JOB)
        expect(again.kinds.truth).toMatchObject({ embedded: 0, marked: 0, removed: 0, unchanged: 5 })
        expect(index.calls.upsert).toBe(upserts)
        expect(again.continued).toBe(false)
    })

    it("removes the points of a deleted workspace: the walk over the points asks Postgres which rows still want one", async () => {
        const { reconcile, index, sources } = build()
        sources.passage.put(vectorRowOf("p1", WS))
        const gone = { ...vectorRowOf("zz", WS2).mirror, model: TEST_MODEL, textHash: "h" }
        index.points.passage.set("zz1", { id: "zz1", vector: [1], payload: gone })
        index.points.passage.set("zz2", { id: "zz2", vector: [1], payload: gone })

        const done = await reconcile.run(JOB)

        expect(done.kinds.passage).toMatchObject({ removed: 2, points: 3 })
        expect([...index.points.passage.keys()]).toEqual(["p1"])
    })

    it("walks every kind that declares it is embedded, the base knowledge too", async () => {
        const { reconcile, index, sources } = build()
        const item = vectorRowOf("k1", PLATFORM_TENANT, { mirror: { ...vectorRowOf("k1", PLATFORM_TENANT).mirror, isPublic: true, customerReady: true } })
        sources.base.put(item)

        const done = await reconcile.run(JOB)
        expect(done.kinds.base).toMatchObject({ rows: 1, embedded: 1, rowsWrapped: true })
        expect(index.payloadOf("base", "k1")).toMatchObject({ workspaceId: PLATFORM_TENANT, model: TEST_MODEL })
    })
}

const registerBoundCases = () => {
    it("is bounded per run and resumes from its cursor: 4,096 rows a run, the follow-up queued while it repairs", async () => {
        const { reconcile, index, sources, queue, states, embedder } = build()
        // Every row holds its point, with flags the rows no longer have (a document released to customers): repairs with no call.
        for (let at = 0; at < 10_000; at += 1) {
            const row = vectorRowOf(idOf(at), WS, { mirror: { ...vectorRowOf(idOf(at), WS).mirror, isPublic: true } })
            sources.passage.put(row)
            index.put("passage", row.id, [at], { ...row.mirror, isPublic: false, model: TEST_MODEL, textHash: row.textHash })
        }

        const first = await reconcile.run(JOB)
        expect(first.kinds.passage).toMatchObject({ rows: 4096, marked: 4096, embedded: 0, rowsWrapped: false })
        expect(first.continued).toBe(true)
        expect(queue.enqueueReconcile).toHaveBeenCalledWith({ resumedAt: NOW.getTime() }, expect.anything())
        expect(states.get("passage")).toMatchObject({ rowsAfter: idOf(4095) })

        expect(await settle(reconcile)).toBe(2)
        expect([...index.points.passage.values()].every((point) => point.payload.isPublic)).toBe(true)
        expect(states.get("passage")).toMatchObject({ rowsAfter: null, passes: 1 })
        expect(embedder.calls).toBe(0)

        // A clean pass queues no follow-up: it waits for the tick.
        queue.enqueueReconcile.mockClear()
        const clean = await reconcile.run(JOB)
        expect(clean.kinds.passage).toMatchObject({ unchanged: 4096, marked: 0 })
        expect(queue.enqueueReconcile).not.toHaveBeenCalled()
    })

    it("stops a run at its embedding budget without skipping a row: the same page is met again", async () => {
        const { reconcile, index, sources, embedder } = build()
        for (let at = 0; at < 1500; at += 1) sources.truth.put(vectorRowOf(idOf(at), WS))

        const first = await reconcile.run(JOB)
        // 32 calls of 32 lines = 1,024 rows = four pages; the fifth page finds the budget spent and is not passed.
        expect(embedder.calls).toBe(32)
        expect(first.kinds.truth).toMatchObject({ embedded: 1024, rows: 1024, waiting: 256, rowsWrapped: false })
        expect(first.continued).toBe(true)

        await settle(reconcile)
        expect(index.points.truth.size).toBe(1500)
        expect(embedder.texts).toBe(1500)
    })

    it("rows waiting for credits are not a failure: the walk passes them, nothing throws, and they are embedded when credits return", async () => {
        const { reconcile, index, sources, embedder } = build()
        for (let at = 0; at < 40; at += 1) sources.truth.put(vectorRowOf(idOf(at), WS))
        embedder.answer = "blocked"

        for (let run = 0; run < 5; run += 1) {
            const done = await reconcile.run(JOB)
            expect(done).toMatchObject({ continued: false })
            expect(done.kinds.truth).toMatchObject({ waiting: 40, rowsWrapped: true })
        }

        embedder.answer = "vectors"
        await reconcile.run(JOB)
        expect(index.points.truth.size).toBe(40)
    })
}

const registerOutageCases = () => {
    it("an index that is down THROWS the transient the runner retries on its ladder: no cursor moves, no follow-up is queued, no drift is counted", async () => {
        const { reconcile, index, sources, states, queue } = build()
        sources.passage.put(vectorRowOf("p1", WS), vectorRowOf("p2", WS2))
        index.down = true

        const thrown = await reconcile.run(JOB).catch((cause: unknown) => cause)

        expect(thrown).toMatchObject({ code: VectorSyncErrorCode.IndexUnavailable })
        expect(classifyFailure(thrown)).toBe("transient")
        expect(states.size).toBe(0)
        expect(queue.enqueueReconcile).not.toHaveBeenCalled()

        // The index is back: the same job (resumed, or retried) repairs and the run is saved.
        index.down = false
        const back = await reconcile.run(JOB)
        expect(back.kinds.passage).toMatchObject({ embedded: 2 })
        expect(index.points.passage.size).toBe(2)
        expect(states.get("passage")).toMatchObject({ rowsAfter: null })
    })

    it("an embedding provider that fails throws out of the run (nothing is saved), and the run that follows finishes the page", async () => {
        const { reconcile, sources, embedder, states } = build()
        sources.truth.put(vectorRowOf("t1", WS))
        embedder.answer = "failed"

        const thrown = await reconcile.run(JOB).catch((cause: unknown) => cause)

        expect(thrown).toMatchObject({ code: VectorSyncErrorCode.EmbeddingUnavailable })
        expect(states.size).toBe(0)

        embedder.answer = "vectors"
        const done = await reconcile.run(JOB)
        expect(done.kinds.truth).toMatchObject({ embedded: 1 })
        expect(states.get("truth")).toMatchObject({ rowsAfter: null })
    })

    it("keys the preparing of the index, the embedding calls and the index writes of a run by the job, so a resumed run is not made twice when settled", async () => {
        const { reconcile, sources, chain } = build()
        sources.truth.put(vectorRowOf("t1", WS))

        await reconcile.run(JOB)

        // Preparing the collections creates them when missing: an outside act, keyed first.
        expect(chain.ledger.keys()).toEqual(["job-1:prepare", "job-1:embed:truth:t1", "job-1:upsert:truth:t1"])
    })
}

const registerWorkloadCases = () => {
    it("walks 200,000 passages whose points stand (the state after the pgvector drop): compares, writes nothing, embeds nothing", async () => {
        const { reconcile, index, sources, embedder } = build()
        const N = 200_000
        for (let at = 0; at < N; at += 1) {
            const row = vectorRowOf(idOf(at), WS, { stamped: true, stampedModel: TEST_MODEL })
            sources.passage.put(row)
            index.put("passage", row.id, [at], { ...row.mirror, model: TEST_MODEL, textHash: row.textHash })
        }

        // A clean run queues no follow-up: each tick walks 4,096 rows until the pass wraps.
        let runs = 0
        let wrapped = false
        while (!wrapped && runs < 100) {
            runs += 1
            const done = await reconcile.run(JOB)
            expect(done.continued).toBe(false)
            wrapped = done.kinds.passage?.rowsWrapped === true
        }

        expect(index.points.passage.size).toBe(N)
        expect(embedder.calls).toBe(0)
        expect({
            runs,
            rowPages: sources.passage.calls.page,
            stampReads: index.calls.stampsOf,
            upserts: index.calls.upsert ?? 0,
            postgresStamps: sources.passage.calls.stamp ?? 0,
        }).toEqual({
            // 49 runs of 4,096 rows (the 49th reads the last 3,392 rows and the empty page that ends the pass).
            runs: 49,
            // 782 pages of 256 rows + the empty page that ends the pass.
            rowPages: 783,
            // One read of the points of a page's ids per page.
            stampReads: 782,
            // Nothing written to the index, nothing stamped in Postgres.
            upserts: 0,
            postgresStamps: 0,
        })
    })

    it("rebuilds a lost index by embedding again: one call per 32 passages, 1,024 passages a run (200,000 = 6,250 calls, 196 runs)", async () => {
        const { reconcile, index, sources, embedder } = build()
        // A tenth of the 200,000 workload: the walk is linear in the rows (the copy rebuild above runs the full size).
        const N = 20_000
        for (let at = 0; at < N; at += 1) sources.passage.put(vectorRowOf(idOf(at), WS))

        const runs = await settle(reconcile)

        expect(index.points.passage.size).toBe(N)
        expect(embedder.calls).toBe(N / 32)
        expect(embedder.texts).toBe(N)
        // 1,024 rows a run (the embedding budget), back to back.
        expect(runs).toBe(Math.ceil(N / 1024))
        expect({ calls: 200_000 / 32, runs: Math.ceil(200_000 / 1024) }).toEqual({ calls: 6250, runs: 196 })
    })
}

describe("VectorReconcileService", () => {
    describe("drift", registerDriftCases)
    describe("bounds", registerBoundCases)
    describe("outage", registerOutageCases)
    describe("workload", registerWorkloadCases)
})
