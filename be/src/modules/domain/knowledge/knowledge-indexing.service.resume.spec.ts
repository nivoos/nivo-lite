import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { INDEXING_WS, MANY, sourceOf, stored } from "@tests/fixtures/builders/knowledge-indexing.builder"
import { KnowledgeChunksService, chunkPassages } from "@modules/domain/knowledge-chunks"
import { BlockedSourcesService, KnowledgeSourcesService, SourcePartsService } from "@modules/domain/knowledge-sources"
import type { SourceRecord } from "@modules/domain/knowledge-sources"
import { DocumentsError, DocumentsErrorCode } from "@modules/integrations/documents"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { EFFECTS } from "@modules/platform/effects/effects.decorators"
import type { Effects } from "@modules/platform/effects"
import { JOB_PROGRESS, type ClaimedJob, type JobProgress } from "@modules/platform/jobs"
import { EmbeddingService } from "./embedding.service"
import { KnowledgeIndexingService } from "./knowledge-indexing.service"
import { EMBED_BATCH } from "./knowledge.contracts"
import { SourceReaderService } from "./source-reader.service"
import { UnchangedSourceService } from "./unchanged-source.service"
import { UsageMeterService } from "./usage-meter.service"
import { VectorSyncService } from "@modules/domain/vector-sync"

const WS = INDEXING_WS
const run = { sourceId: "s1", workspaceId: WS }
const JOB: ClaimedJob = { jobId: "job-1", kind: "knowledge.index", fencingToken: 1, currentStep: null, payload: run }

/** The effects port with no ledger: every act is made. */
const effects: Effects = {
    once: <T,>(_key: string, _effect: unknown, call: { readonly act: () => Promise<T> }): Promise<T> => call.act(),
    settleIn: () => Promise.resolve(),
}

const build = async (source: SourceRecord | null = sourceOf()) => {
    const sources = mock<KnowledgeSourcesService>()
    const blocked = mock<BlockedSourcesService>()
    const parts = mock<SourcePartsService>()
    const chunks = mock<KnowledgeChunksService>()
    const reader = mock<SourceReaderService>()
    const embeddings = mock<EmbeddingService>()
    const usage = mock<UsageMeterService>()
    const unchanged = mock<UnchangedSourceService>()
    const logger = mock<Logger>()
    const vectorSync = mock<VectorSyncService>()
    const progress = mock<JobProgress>()
    sources.sourceOf.mockResolvedValue(source)
    reader.read.mockResolvedValue({ kind: "ok", value: { text: source?.content ?? "", title: null } })
    embeddings.configured.mockReturnValue(true)
    embeddings.model.mockReturnValue("m1")
    embeddings.embed.mockResolvedValue([[0.5, 1]])
    chunks.embeddedOf.mockResolvedValue([])
    // Each stored passage answers the id it was stored under (the point id of its vector).
    chunks.keep.mockImplementation(async (write, within) => {
        await within?.({} as never)
        return write.drafts.map((draft) => ({ order: draft.order, id: `c${String(draft.order)}` }))
    })
    unchanged.holdsWhole.mockResolvedValue(false)
    unchanged.keep.mockResolvedValue("skipped")
    usage.blockedBy.mockResolvedValue(false)
    const moduleRef = await Test.createTestingModule({
        providers: [
            KnowledgeIndexingService,
            { provide: KnowledgeSourcesService, useValue: sources },
            { provide: BlockedSourcesService, useValue: blocked },
            { provide: SourcePartsService, useValue: parts },
            { provide: KnowledgeChunksService, useValue: chunks },
            { provide: SourceReaderService, useValue: reader },
            { provide: UnchangedSourceService, useValue: unchanged },
            { provide: EmbeddingService, useValue: embeddings },
            { provide: UsageMeterService, useValue: usage },
            { provide: LOGGER, useValue: logger },
            { provide: VectorSyncService, useValue: vectorSync },
            { provide: EFFECTS, useValue: effects },
            { provide: JOB_PROGRESS, useValue: progress },
        ],
    }).compile()
    const service = moduleRef.get(KnowledgeIndexingService)
    return { service, sources, blocked, parts, chunks, reader, unchanged, embeddings, usage, logger, vectorSync, progress }
}

const registerResumeCases = () => {
    it("queues the credit-blocked documents again once their workspace has credits: one pool read per workspace, the others keep waiting", async () => {
        const { service, blocked, usage, logger } = await build()
        blocked.waiting.mockResolvedValue([
            { id: "a1", workspaceId: "ws-a" },
            { id: "a2", workspaceId: "ws-a" },
            { id: "b1", workspaceId: "ws-b" },
        ])
        usage.blockedBy.mockImplementation((workspaceId) => Promise.resolve(workspaceId === "ws-b"))
        // Another tick moved a2 first.
        blocked.resume.mockImplementation((_ws, id) => Promise.resolve(id === "a1"))

        await expect(service.resumeBlocked()).resolves.toBe(1)

        expect(blocked.waiting).toHaveBeenCalledWith(50)
        expect(usage.blockedBy.mock.calls).toEqual([
            ["ws-a", "embedding", true],
            ["ws-b", "embedding", true],
        ])
        expect(blocked.resume.mock.calls).toEqual([
            ["ws-a", "a1"],
            ["ws-a", "a2"],
        ])
        expect(logger.info).toHaveBeenCalledTimes(1)
    })
    it("throws a read that fails: no catch counts it, the tick that runs it is a job the runner retries", async () => {
        const { service, blocked } = await build()
        const down = new Error("db down")
        blocked.waiting.mockRejectedValue(down)

        await expect(service.resumeBlocked()).rejects.toBe(down)
    })
}


describe("KnowledgeIndexingService: credits came back and resumeBlocked (D-U-4)", () => {
    registerResumeCases()
})

describe("KnowledgeIndexingService a passage that moved", () => {
    it("keeps its vector at the new order, is not embedded, and counts as done", async () => {
        const content = `${"n".repeat(500)}\n\n${"o".repeat(500)}`
        const { service, sources, chunks, embeddings } = await build(sourceOf({ content }))
        const [first, second] = chunkPassages(content)
        chunks.embeddedOf.mockResolvedValue([stored(second ?? "", 0)])

        await expect(service.index(run, JOB)).resolves.toBe("indexed")

        expect(chunks.arrange).toHaveBeenCalledWith(
            expect.objectContaining({ moves: [{ id: "c0", order: 1 }], count: 2 }),
        )
        expect(embeddings.embed.mock.calls.flatMap(([request]) => request.texts)).toEqual([first])
        expect(sources.enterStage).toHaveBeenCalledWith(WS, "s1", expect.objectContaining({ stage: "embed", done: 1 }))
    })
})

describe("KnowledgeIndexingService resume after a failure", () => {
    const unavailable = new DocumentsError({ code: DocumentsErrorCode.Unavailable })

    it("keeps the batches stored before a failure and embeds only the rest on the retry", async () => {
        const { service, chunks, embeddings } = await build(sourceOf({ content: MANY }))
        const pieces = chunkPassages(MANY)
        embeddings.embed
            .mockImplementationOnce((request) => Promise.resolve(request.texts.map(() => [1])))
            .mockRejectedValueOnce(unavailable)

        await expect(service.index(run, JOB)).rejects.toBe(unavailable)

        expect(chunks.keep).toHaveBeenCalledTimes(1)

        chunks.embeddedOf.mockResolvedValue(pieces.slice(0, EMBED_BATCH).map(stored))
        embeddings.embed.mockReset()
        embeddings.embed.mockImplementation((request) => Promise.resolve(request.texts.map(() => [1])))

        await expect(service.index(run, JOB)).resolves.toBe("indexed")

        const embedded = embeddings.embed.mock.calls.flatMap(([request]) => request.texts)
        expect(embedded).toEqual(pieces.slice(EMBED_BATCH))
        expect(chunks.keep.mock.calls.at(-1)?.[0].drafts.at(0)?.order).toBe(EMBED_BATCH * 2)
    })

    it("counts the passages kept from the failed run as done", async () => {
        const { service, sources, chunks } = await build(sourceOf({ content: MANY }))
        const pieces = chunkPassages(MANY)
        chunks.embeddedOf.mockResolvedValue(pieces.slice(0, 10).map(stored))

        await service.index(run, JOB)

        expect(sources.enterStage).toHaveBeenCalledWith(
            WS,
            "s1",
            expect.objectContaining({ stage: "embed", done: 10, total: pieces.length }),
        )
    })
})
