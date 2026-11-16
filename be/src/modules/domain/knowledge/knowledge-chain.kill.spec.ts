import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { INDEXING_WS, MANY, sourceOf, stored } from "@tests/fixtures/builders/knowledge-indexing.builder"
import { DOC_SOURCE, DOC_WS } from "@tests/fixtures/builders/document-facts.builder"
import { existingSourcesProvider, filedAs, scriptStageDoubles, stageRulesOf, stageReply, stageSource, STAGES_STATE } from "@tests/fixtures/builders/brain-document.builder"
import { chainProviders, claimedJob } from "@tests/fixtures/builders/knowledge-chain.builder"
import { FakeEmbedder, FakeRowSource, FakeVectorIndex, vectorRowOf } from "@tests/fixtures/builders/vector-sync.builder"
import { WorkspaceTimeZoneService } from "@modules/domain/workspace-settings"
import { BrainExtractionsService } from "@modules/domain/brain-extractions"
import { BrainFactsService } from "@modules/domain/brain-facts"
import { KnowledgeChunksService, chunkPassages } from "@modules/domain/knowledge-chunks"
import { BlockedSourcesService, KnowledgeSourcesService, SourcePartsService } from "@modules/domain/knowledge-sources"
import { VectorSyncService } from "@modules/domain/vector-sync"
import { AI } from "@modules/integrations/ai"
import type { AiService } from "@modules/integrations/ai"
import { VECTOR_INDEX } from "@modules/integrations/qdrant"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { VectorSyncQueue } from "@modules/queues/vector-sync"
import { DocumentNatureService } from "../brain/document-nature.service"
import { DocumentTruthStagesService } from "../brain/document-truth-stages.service"
import { TRUTHS_VERSION } from "../brain/extraction.policy"
import { FactEmbeddingsService } from "../brain/fact-embeddings.service"
import { ModelJsonService } from "../brain/model-json.service"
import { UsageMeterService } from "./usage-meter.service"
import { EmbeddingService } from "./embedding.service"
import { KnowledgeIndexingService } from "./knowledge-indexing.service"
import { EMBED_BATCH } from "./knowledge.contracts"
import { SourceReaderService } from "./source-reader.service"
import { UnchangedSourceService } from "./unchanged-source.service"
import { VECTOR_EMBEDDER, VECTOR_ROW_SOURCES } from "../vector-sync/vector-sync.decorators"

/** The process "dies" here: the error an act throws when its worker is gone before the act's outcome is known. */
const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

describe("knowledge chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    describe("index: a kill after the embedding of batch 1 settled and before batch 2", () => {
        const build = async () => {
            const chain = chainProviders()
            const sources = mock<KnowledgeSourcesService>()
            const chunks = mock<KnowledgeChunksService>()
            const reader = mock<SourceReaderService>()
            const embeddings = mock<EmbeddingService>()
            const usage = mock<UsageMeterService>()
            const unchanged = mock<UnchangedSourceService>()
            const vectorSync = mock<VectorSyncService>()
            const source = sourceOf({ content: MANY })
            sources.sourceOf.mockResolvedValue(source)
            sources.exists.mockResolvedValue(true)
            reader.read.mockResolvedValue({ kind: "ok", value: { text: MANY, title: null } })
            embeddings.configured.mockReturnValue(true)
            embeddings.model.mockReturnValue("m1")
            embeddings.embed.mockImplementation((request) => Promise.resolve(request.texts.map(() => [1])))
            chunks.embeddedOf.mockResolvedValue([])
            chunks.replace.mockResolvedValue(true)
            chunks.keep.mockImplementation(async (write, within) => {
                await within?.({} as never)
                return write.drafts.map((draft) => ({ order: draft.order, id: `c${String(draft.order)}` }))
            })
            unchanged.holdsWhole.mockResolvedValue(false)
            usage.blockedBy.mockResolvedValue(false)
            const moduleRef = await Test.createTestingModule({
                providers: [
                    ...chain.providers,
                    KnowledgeIndexingService,
                    { provide: KnowledgeSourcesService, useValue: sources },
                    { provide: BlockedSourcesService, useValue: mock<BlockedSourcesService>() },
                    { provide: SourcePartsService, useValue: mock<SourcePartsService>() },
                    { provide: KnowledgeChunksService, useValue: chunks },
                    { provide: SourceReaderService, useValue: reader },
                    { provide: UnchangedSourceService, useValue: unchanged },
                    { provide: EmbeddingService, useValue: embeddings },
                    { provide: UsageMeterService, useValue: usage },
                    { provide: LOGGER, useValue: mock<Logger>() },
                    { provide: VectorSyncService, useValue: vectorSync },
                ],
            }).compile()
            return { service: moduleRef.get(KnowledgeIndexingService), chain, sources, chunks, embeddings, vectorSync, source }
        }

        it("embeds batch 1 once, finishes the document on the second run and hands over in the finishing transaction", async () => {
            const t = await build()
            const run = { sourceId: "s1", workspaceId: INDEXING_WS }
            const job = claimedJob(run, { kind: "knowledge.index" })
            const pieces = chunkPassages(MANY)
            expect(pieces.length).toBeGreaterThan(EMBED_BATCH)
            // The effect of batch 2 never gets its act: the worker is gone after batch 1 settled with its stored passages.
            t.chain.ledger.failNext(`job-1:embed:${String(EMBED_BATCH)}`, killed())

            await expect(t.service.index(run, job)).rejects.toMatchObject({ code: "ECONNRESET" })

            expect(t.embeddings.embed).toHaveBeenCalledTimes(1)
            expect(t.chain.ledger.settled()).toEqual(["job-1:embed:0"])
            expect(t.sources.finishIndexing).not.toHaveBeenCalled()

            // The database now holds the passages batch 1 stored (what `chunks.keep` committed with its settle): the plan skips them.
            t.chunks.embeddedOf.mockResolvedValue(pieces.slice(0, EMBED_BATCH).map(stored))
            await expect(t.service.index(run, job)).resolves.toBe("indexed")

            // Batch 1 was NOT embedded again: its key was acted once, every later key once; the document finished once.
            expect(t.chain.ledger.rows.get("job-1:embed:0")?.acts).toBe(1)
            expect(t.chain.ledger.keys().filter((key) => key.includes(":embed:"))).toEqual(
                Array.from({ length: Math.ceil(pieces.length / EMBED_BATCH) }, (_, index) => `job-1:embed:${String(index * EMBED_BATCH)}`),
            )
            expect(t.embeddings.embed.mock.calls.flatMap(([request]) => request.texts)).toEqual(pieces)
            expect(t.sources.finishIndexing).toHaveBeenCalledTimes(1)
            const within = t.sources.finishIndexing.mock.calls[0]?.[4]
            const tx = Symbol("finishing transaction") as never
            await within?.(tx)
            expect(t.vectorSync.changedSource).toHaveBeenCalledWith(INDEXING_WS, "s1", tx)
        })
    })

    describe("facts: a kill after window 1 was read and filed and before window 2", () => {
        const build = async () => {
            const chain = chainProviders()
            const ai = mock<AiService>()
            const facts = mock<BrainFactsService>()
            const chunks = mock<KnowledgeChunksService>()
            const usage = mock<UsageMeterService>()
            const vectors = mock<FactEmbeddingsService>()
            const nature = mock<DocumentNatureService>()
            scriptStageDoubles({ ai, usage, vectors, nature })
            facts.propose.mockImplementation((_ws, input) => filedAs(`f-${input.value}`, input.value))
            const moduleRef = await Test.createTestingModule({
                providers: [
                    ...chain.providers,
                    DocumentTruthStagesService,
                    ModelJsonService,
                    { provide: AI, useValue: ai },
                    { provide: LOGGER, useValue: mock<Logger>() },
                    { provide: CLOCK, useValue: new FakeClock(new Date("2026-11-11T15:00:00.000Z")) },
                    { provide: BrainFactsService, useValue: facts },
                    { provide: BrainExtractionsService, useValue: mock<BrainExtractionsService>() },
                    existingSourcesProvider(),
                    { provide: KnowledgeChunksService, useValue: chunks },
                    { provide: UsageMeterService, useValue: usage },
                    { provide: FactEmbeddingsService, useValue: vectors },
                    { provide: DocumentNatureService, useValue: nature },
                    { provide: WorkspaceTimeZoneService, useValue: mock<WorkspaceTimeZoneService>({ timeZoneOf: () => Promise.resolve("Asia/Ho_Chi_Minh") }) },
                ],
            }).compile()
            return { service: moduleRef.get(DocumentTruthStagesService), chain, ai, facts, chunks }
        }

        it("asks the model for window 1 once; the second run reads only window 2 and the reading finishes", async () => {
            const t = await build()
            const job = claimedJob({ sourceId: DOC_SOURCE, workspaceId: DOC_WS }, { kind: "knowledge.facts" })
            const passages = stageRulesOf(8)
            t.ai.chat.mockResolvedValue(
                stageReply(["1|policy|Shipping inside the city|fee|30.000 VND|-|-|-", "2|skip|L1|duplicate", "3|skip|L1|duplicate", "4|skip|L1|duplicate"].join(String.fromCharCode(10))),
            )
            // The worker dies before window 2's call (windows of four passages: c4 starts the second).
            t.chain.ledger.failNext("job-1:model:extract:c4:1", killed())

            await expect(t.service.extract({ job, source: stageSource, passages, state: STAGES_STATE })).rejects.toMatchObject({ code: "ECONNRESET" })

            expect(t.ai.chat).toHaveBeenCalledTimes(1)
            expect(t.chunks.markTruthsRead).toHaveBeenCalledWith(DOC_WS, ["c0", "c1", "c2", "c3"], TRUTHS_VERSION)

            // The rows window 1 wrote are in the database: its passages are marked read by this version, so the next run skips them.
            const afterKill = passages.map((passage, index) =>
                index < 4 ? { ...passage, truthsVersion: TRUTHS_VERSION } : passage,
            )
            const result = await t.service.extract({ job, source: stageSource, passages: afterKill, state: { ...STAGES_STATE, done: 1, filed: 1 } })

            expect(result).toMatchObject({ end: "done" })
            expect(t.ai.chat).toHaveBeenCalledTimes(2)
            expect(t.chain.ledger.rows.get("job-1:model:extract:c0:1")?.acts).toBe(1)
            expect(t.chain.ledger.rows.get("job-1:model:extract:c4:1")?.acts).toBe(1)
        })
    })

    describe("vectors: a kill after the first batch of rows was written and stamped and before the second", () => {
        it("embeds and writes the first batch once; the second run does only the rest", async () => {
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
            const WS = "11111111-1111-4111-8111-111111111111"
            const ids = Array.from({ length: 70 }, (_, at) => `t${String(at).padStart(3, "0")}`)
            for (const id of ids) rows.truth.put(vectorRowOf(id, WS))
            const job = claimedJob({ kind: "truth", workspaceId: WS, ids, at: 1 }, { kind: "vector.sync" })
            // Batches of 32 rows in id order: t000, t032, t064. The worker dies before the second batch's embedding call.
            chain.ledger.failNext("job-1:embed:truth:t032", killed())

            await expect(service.sync(job)).rejects.toMatchObject({ code: "ECONNRESET" })

            expect(embedder.calls).toBe(1)
            expect(index.points.truth.size).toBe(32)
            expect(rows.truth.rows.get("t000")?.stamped).toBe(true)
            expect(rows.truth.rows.get("t032")?.stamped).toBe(false)

            await expect(service.sync(job)).resolves.toMatchObject({ embedded: 38, unchanged: 32 })

            // Batch 1 was not embedded again: three embedding calls in all (32, 32, 6 rows), each key acted once.
            expect(embedder.calls).toBe(3)
            expect(embedder.texts).toBe(70)
            expect(chain.ledger.rows.get("job-1:embed:truth:t000")?.acts).toBe(1)
            expect(chain.ledger.rows.get("job-1:upsert:truth:t000")?.acts).toBe(1)
            expect(index.points.truth.size).toBe(70)
        })
    })
})

