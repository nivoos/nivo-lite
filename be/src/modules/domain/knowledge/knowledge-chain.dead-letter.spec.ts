import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { INDEXING_WS, sourceOf } from "@tests/fixtures/builders/knowledge-indexing.builder"
import { DOC_WS } from "@tests/fixtures/builders/document-facts.builder"
import { existingSourcesProvider, scriptStageDoubles, stagePassageOf, stageSource, STAGES_RULE, STAGES_STATE } from "@tests/fixtures/builders/brain-document.builder"
import { chainProviders } from "@tests/fixtures/builders/knowledge-chain.builder"
import { FakeEmbedder, FakeRowSource, FakeVectorIndex, vectorRowOf } from "@tests/fixtures/builders/vector-sync.builder"
import { WorkspaceTimeZoneService } from "@modules/domain/workspace-settings"
import { BrainExtractionsService } from "@modules/domain/brain-extractions"
import { BrainFactsService } from "@modules/domain/brain-facts"
import { KnowledgeChunksService } from "@modules/domain/knowledge-chunks"
import { BlockedSourcesService, KnowledgeSourceCitesService, KnowledgeSourcesService, SourcePartsService, StoredNote } from "@modules/domain/knowledge-sources"
import { VectorSyncService } from "@modules/domain/vector-sync"
import { AI } from "@modules/integrations/ai"
import type { AiService } from "@modules/integrations/ai"
import { VECTOR_INDEX } from "@modules/integrations/qdrant"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import {
    FencedProcessor,
    JOB_CLAIMS,
    JobDeadLettersService,
    JobRenewalService,
    JobRunnerService,
    JobStateEventsService,
    type ClaimedJob,
    type JobClaims,
} from "@modules/platform/jobs"
import { JOBS_OPTIONS } from "@modules/platform/jobs/jobs.decorators"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_WORKER_REGISTRY, QueueError, QueueErrorCode } from "@modules/platform/queue"
import type { QueueDelivery, QueueWorkerRegistry } from "@modules/platform/queue"
import { INDEX_SOURCE_JOB, EXTRACT_FACTS_JOB } from "@modules/queues/knowledge"
import { SYNC_VECTORS_JOB, VectorSyncQueue } from "@modules/queues/vector-sync"
import { DocumentNatureService } from "../brain/document-nature.service"
import { DocumentTruthStagesService } from "../brain/document-truth-stages.service"
import { FactEmbeddingsService } from "../brain/fact-embeddings.service"
import { ModelJsonService } from "../brain/model-json.service"
import { TRIAGE_VERSION } from "../brain/passage-triage.policy"
import { EmbeddingService } from "./embedding.service"
import { KnowledgeIndexingService } from "./knowledge-indexing.service"
import { KnowledgeJobsService } from "./knowledge-jobs.service"
import { SourceReaderService } from "./source-reader.service"
import { UnchangedSourceService } from "./unchanged-source.service"
import { UsageMeterService } from "./usage-meter.service"
import { VECTOR_EMBEDDER, VECTOR_ROW_SOURCES } from "../vector-sync/vector-sync.decorators"

const WS = INDEXING_WS
const deliveryOf = (queue: string, job: string, payload: object, attempt: number): QueueDelivery => ({
    id: "k-1",
    queue,
    job,
    payload,
    attempt,
    signal: new AbortController().signal,
})

/** What the network says when nothing answers: the classifier calls it transient. */
const refused = (): Error => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6333"), { code: "ECONNREFUSED" })

/** The runner of fenced jobs over a claims double: the real classifier, the real ladders, the real dead-letter path. */
const buildRunner = async (resumeCount = 0) => {
    const claims = mock<JobClaims>()
    const job = (payload: object): ClaimedJob => ({ jobId: "job-1", kind: "x", fencingToken: 1, currentStep: null, payload, ...(resumeCount > 0 ? { resumeCount } : {}) })
    claims.park.mockResolvedValue(true)
    claims.fail.mockResolvedValue(undefined)
    claims.release.mockResolvedValue(undefined)
    claims.complete.mockResolvedValue(undefined)
    claims.retryAfterSeconds.mockResolvedValue(null)
    const deadLetters = mock<JobDeadLettersService>()
    deadLetters.raise.mockResolvedValue(undefined)
    const states = mock<JobStateEventsService>()
    states.changed.mockResolvedValue(undefined)
    const renewals = mock<JobRenewalService>()
    renewals.keep.mockReturnValue({ stop: jest.fn() })
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobRunnerService,
            { provide: JOBS_OPTIONS, useValue: { connection: "primary", workerId: "w-1", leaseMs: 60_000, scheduler: { enabled: false }, buildId: "b1" } },
            { provide: JOB_CLAIMS, useValue: claims },
            { provide: QUEUE_WORKER_REGISTRY, useValue: mock<QueueWorkerRegistry>() },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: JobRenewalService, useValue: renewals },
            { provide: JobDeadLettersService, useValue: deadLetters },
            { provide: JobStateEventsService, useValue: states },
        ],
    }).compile()
    return { runner: moduleRef.get(JobRunnerService), claims, deadLetters, claimed: (payload: object) => claims.claim.mockResolvedValue(job(payload)) }
}

/** The processor of the index job as the feature composes it: one domain method, the dead letter writes the source's state. */
class IndexProcessor extends FencedProcessor {
    override readonly queue = "knowledge_index"
    override readonly definition = INDEX_SOURCE_JOB
    constructor(private readonly jobs: KnowledgeJobsService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.jobs.index(job)
    }
    override async onFailed(delivery: QueueDelivery, cause: unknown): Promise<void> {
        await this.jobs.indexFailed(delivery.payload, cause)
    }
}

describe("knowledge chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes without repeating", () => {
    describe("(a) a broken file", () => {
        const build = async (status = "queued") => {
            const chain = chainProviders()
            const sources = mock<KnowledgeSourcesService>()
            const reader = mock<SourceReaderService>()
            const unchanged = mock<UnchangedSourceService>()
            const embeddings = mock<EmbeddingService>()
            const usage = mock<UsageMeterService>()
            const chunks = mock<KnowledgeChunksService>()
            let current = status
            sources.sourceOf.mockImplementation(() => Promise.resolve(sourceOf({ kind: "file", status: current })))
            sources.exists.mockResolvedValue(true)
            sources.fail.mockImplementation(() => {
                current = "failed"
                return Promise.resolve()
            })
            unchanged.holdsWhole.mockResolvedValue(false)
            embeddings.configured.mockReturnValue(true)
            embeddings.model.mockReturnValue("m1")
            embeddings.embed.mockImplementation((request) => Promise.resolve(request.texts.map(() => [1])))
            chunks.embeddedOf.mockResolvedValue([])
            chunks.replace.mockResolvedValue(true)
            chunks.keep.mockImplementation((write) => Promise.resolve(write.drafts.map((draft) => ({ order: draft.order, id: `c${String(draft.order)}` }))))
            usage.blockedBy.mockResolvedValue(false)
            const moduleRef = await Test.createTestingModule({
                providers: [
                    ...chain.providers,
                    KnowledgeIndexingService,
                    KnowledgeJobsService,
                    { provide: KnowledgeSourcesService, useValue: sources },
                    { provide: BlockedSourcesService, useValue: mock<BlockedSourcesService>() },
                    { provide: SourcePartsService, useValue: mock<SourcePartsService>() },
                    { provide: KnowledgeChunksService, useValue: chunks },
                    { provide: SourceReaderService, useValue: reader },
                    { provide: UnchangedSourceService, useValue: unchanged },
                    { provide: EmbeddingService, useValue: embeddings },
                    { provide: UsageMeterService, useValue: usage },
                    { provide: KnowledgeSourceCitesService, useValue: mock<KnowledgeSourceCitesService>() },
                    { provide: LOGGER, useValue: mock<Logger>() },
                    { provide: VectorSyncService, useValue: mock<VectorSyncService>() },
                ],
            }).compile()
            return { processor: new IndexProcessor(moduleRef.get(KnowledgeJobsService)), sources, reader }
        }

        it("throws input at once: no retry, the job parks with the refusal as its reason, ONE item, the source row says failed with the stored note", async () => {
            const t = await build()
            const h = await buildRunner()
            const payload = { sourceId: "s1", workspaceId: WS }
            h.claimed(payload)
            t.reader.read.mockResolvedValue({ kind: "refused", code: StoredNote.TypeUnsupported })

            await h.runner.run(t.processor, deliveryOf("knowledge_index", INDEX_SOURCE_JOB.name, payload, 1))

            expect(h.claims.fail).not.toHaveBeenCalled()
            expect(h.claims.park).toHaveBeenCalledTimes(1)
            expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "KNOWLEDGE_SOURCE_REFUSED", queue: "knowledge_index" }))
            expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
            expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", failureClass: "input", workspaceId: WS, jobId: "job-1" }))
            // The row says failed with the stored note (written when the file was refused); the dead letter's hook keeps it.
            expect(t.sources.fail).toHaveBeenCalledTimes(1)
            expect(t.sources.fail).toHaveBeenCalledWith(WS, "s1", StoredNote.TypeUnsupported)
        })

        it("resume after the file was replaced: the job runs again over the source the dead letter closed as failed and finishes the document", async () => {
            const t = await build("failed")
            const h = await buildRunner(1)
            const payload = { sourceId: "s1", workspaceId: WS }
            h.claimed(payload)
            t.reader.read.mockResolvedValue({ kind: "ok", value: { text: "Open 8 to 21", title: null } })

            await h.runner.run(t.processor, deliveryOf("knowledge_index", INDEX_SOURCE_JOB.name, payload, 1))

            expect(t.sources.finishIndexing).toHaveBeenCalledTimes(1)
            expect(h.claims.complete).toHaveBeenCalledTimes(1)
            expect(h.claims.park).not.toHaveBeenCalled()
            expect(h.deadLetters.raise).not.toHaveBeenCalled()
        })
    })

    describe("(b) a model refusal in the facts", () => {
        it("throws input from the stage: one dead letter with one item, the processor's failure hook runs once, no retry is spent", async () => {
            const chain = chainProviders()
            const ai = mock<AiService>()
            const usage = mock<UsageMeterService>()
            const vectors = mock<FactEmbeddingsService>()
            const nature = mock<DocumentNatureService>()
            scriptStageDoubles({ ai, usage, vectors, nature })
            ai.attempt.mockResolvedValue({ ok: false, failure: "empty" })
            const moduleRef = await Test.createTestingModule({
                providers: [
                    ...chain.providers,
                    DocumentTruthStagesService,
                    ModelJsonService,
                    { provide: AI, useValue: ai },
                    { provide: LOGGER, useValue: mock<Logger>() },
                    { provide: CLOCK, useValue: new FakeClock(new Date("2026-11-11T15:00:00.000Z")) },
                    { provide: BrainFactsService, useValue: mock<BrainFactsService>() },
                    { provide: BrainExtractionsService, useValue: mock<BrainExtractionsService>() },
                    existingSourcesProvider(),
                    { provide: KnowledgeChunksService, useValue: mock<KnowledgeChunksService>() },
                    { provide: UsageMeterService, useValue: usage },
                    { provide: FactEmbeddingsService, useValue: vectors },
                    { provide: DocumentNatureService, useValue: nature },
                    { provide: WorkspaceTimeZoneService, useValue: mock<WorkspaceTimeZoneService>({ timeZoneOf: () => Promise.resolve("Asia/Ho_Chi_Minh") }) },
                ],
            }).compile()
            const stages = moduleRef.get(DocumentTruthStagesService)
            const failed = jest.fn().mockResolvedValue(undefined)
            class FactsProcessor extends FencedProcessor {
                override readonly queue = "knowledge"
                override readonly definition = EXTRACT_FACTS_JOB
                async process(job: ClaimedJob): Promise<void> {
                    await stages.triage({ job, source: stageSource, passages: [stagePassageOf(0, STAGES_RULE, { triageVersion: TRIAGE_VERSION - 1 })], state: STAGES_STATE })
                }
                override async onFailed(delivery: QueueDelivery): Promise<void> {
                    await failed(delivery.payload)
                }
            }
            const h = await buildRunner()
            const payload = { sourceId: "s1", workspaceId: DOC_WS }
            h.claimed(payload)

            await h.runner.run(new FactsProcessor(), deliveryOf("knowledge", EXTRACT_FACTS_JOB.name, payload, 1))

            expect(h.claims.fail).not.toHaveBeenCalled()
            expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "BRAIN_MODEL_REFUSED" }))
            expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
            expect(failed).toHaveBeenCalledTimes(1)
        })
    })

    describe("(c) the vector index down", () => {
        const build = async () => {
            const chain = chainProviders()
            const index = new FakeVectorIndex()
            const rows = { passage: new FakeRowSource(), truth: new FakeRowSource(), base: new FakeRowSource() }
            const embedder = new FakeEmbedder()
            const em = mockEntityManager()
            fakeTransaction(em)
            const moduleRef = await Test.createTestingModule({
                providers: [
                    ...chain.providers,
                    VectorSyncService,
                    { provide: VECTOR_INDEX, useValue: index },
                    { provide: VECTOR_ROW_SOURCES, useValue: rows },
                    { provide: VECTOR_EMBEDDER, useValue: embedder },
                    { provide: VectorSyncQueue, useValue: mock<VectorSyncQueue>() },
                    { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
                    { provide: LOGGER, useValue: mock<Logger>() },
                    { provide: CLOCK, useValue: new FakeClock(new Date("2026-11-11T10:00:00.000Z")) },
                ],
            }).compile()
            const service = moduleRef.get(VectorSyncService)
            class SyncProcessor extends FencedProcessor {
                override readonly queue = "vector_sync"
                override readonly definition = SYNC_VECTORS_JOB
                async process(job: ClaimedJob): Promise<void> {
                    await service.sync(job)
                }
            }
            return { chain, index, rows, embedder, processor: new SyncProcessor() }
        }

        it("retries a transient failure on the background ladder (5, 10, 20 s), then parks with ONE item; the resume finishes the rows without embedding the settled batch again", async () => {
            const t = await build()
            const h = await buildRunner()
            const ids = Array.from({ length: 40 }, (_, at) => `t${String(at).padStart(3, "0")}`)
            for (const id of ids) t.rows.truth.put(vectorRowOf(id, DOC_WS))
            const payload = { kind: "truth", workspaceId: DOC_WS, ids, at: 1 }
            h.claimed(payload)
            // The first batch of 32 rows is written; the index then goes away for good (until it is fixed).
            let healed = false
            const upsert = t.index.upsert.bind(t.index)
            let writes = 0
            t.index.upsert = (kind, points) => {
                writes += 1
                return writes > 1 && !healed ? Promise.reject(refused()) : upsert(kind, points)
            }
            const delivery = (attempt: number) => deliveryOf("vector_sync", SYNC_VECTORS_JOB.name, payload, attempt)

            const pauses: Array<number> = []
            for (const attempt of [1, 2, 3]) {
                const thrown = await h.runner.run(t.processor, delivery(attempt)).catch((cause: unknown) => cause)
                expect(thrown).toBeInstanceOf(QueueError)
                expect(thrown).toMatchObject({ code: QueueErrorCode.RetryAfter })
                pauses.push((thrown as QueueError).params.seconds as number)
            }
            expect(pauses).toEqual([5, 10, 20])
            expect(h.claims.park).not.toHaveBeenCalled()
            expect(h.deadLetters.raise).not.toHaveBeenCalled()

            await h.runner.run(t.processor, delivery(4))

            expect(h.claims.park).toHaveBeenCalledTimes(1)
            expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
            expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
            // Batch 1 settled in the first delivery; every later delivery (the ladder) did only the second batch.
            expect(t.chain.ledger.rows.get("job-1:embed:truth:t000")?.acts).toBe(1)

            // The cause is fixed; a person resumes the job.
            healed = true
            const resumed = await buildRunner(1)
            resumed.claimed(payload)
            await resumed.runner.run(t.processor, delivery(1))

            expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
            expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
            expect(t.index.points.truth.size).toBe(40)
            expect(t.chain.ledger.rows.get("job-1:embed:truth:t000")?.acts).toBe(1)
            expect(t.chain.ledger.rows.get("job-1:upsert:truth:t000")?.acts).toBe(1)
        })
    })

    describe("(d) the api killed between steps", () => {
        it("a delivery that already started more often than its ladder allows (every earlier start died) is a dead letter without running: ONE item", async () => {
            const h = await buildRunner()
            const process = jest.fn().mockResolvedValue(undefined)
            class AnyProcessor extends FencedProcessor {
                override readonly queue = "knowledge"
                override readonly definition = EXTRACT_FACTS_JOB
                process = process
            }
            const payload = { sourceId: "s1", workspaceId: WS }
            h.claimed(payload)

            // The background ladder is 4 starts: the fifth is past it.
            await h.runner.run(new AnyProcessor(), deliveryOf("knowledge", EXTRACT_FACTS_JOB.name, payload, 5))

            expect(process).not.toHaveBeenCalled()
            expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
            expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
            expect(h.claims.fail).not.toHaveBeenCalled()
        })
    })
})
