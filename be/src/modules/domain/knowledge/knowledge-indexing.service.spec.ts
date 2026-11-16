import { Test } from "@nestjs/testing"
import { workInScope } from "@modules/platform/logging"
import { classifyFailure } from "@modules/platform/queue"
import { mock } from "@starci/jest-preset"
import {
    INDEXING_WS,
    MANY,
    INDEXING_STALE_PASSAGES,
    INDEXING_EMPTY_TEXTS,
    INDEXING_WHOLE_SOURCE_KINDS,
    INDEXING_TEXT_WRITE,
    INDEXING_EMBED_STAGE,
    INDEXING_STORE_STAGE,
    legacy,
    sourceOf,
    stored,
} from "@tests/fixtures/builders/knowledge-indexing.builder"
import { KnowledgeChunksService, chunkPassages } from "@modules/domain/knowledge-chunks"
import { BlockedSourcesService, KnowledgeSourcesService, MAX_SOURCE_CHARS, StoredNote } from "@modules/domain/knowledge-sources"
import { SourcePartsService, partsOf } from "@modules/domain/knowledge-sources"
import type { SourceRecord } from "@modules/domain/knowledge-sources"
import { DocumentsError, DocumentsErrorCode } from "@modules/integrations/documents"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { EFFECTS } from "@modules/platform/effects/effects.decorators"
import type { Effects } from "@modules/platform/effects"
import { JOB_PROGRESS, type ClaimedJob, type JobProgress } from "@modules/platform/jobs"
import { KnowledgeSourcesError, KnowledgeSourcesErrorCode } from "@modules/domain/knowledge-sources"
import { EmbeddingService } from "./embedding.service"
import { KnowledgeIndexingService } from "./knowledge-indexing.service"
import { KnowledgeError, KnowledgeErrorCode } from "./errors/knowledge.error"
import { EMBED_BATCH } from "./knowledge.contracts"
import { SourceReaderService } from "./source-reader.service"
import { UnchangedSourceService } from "./unchanged-source.service"
import { UsageMeterService } from "./usage-meter.service"
import { VectorSyncService } from "@modules/domain/vector-sync"

const WS = INDEXING_WS
const run = { sourceId: "s1", workspaceId: WS }
const JOB: ClaimedJob = { jobId: "job-1", kind: "knowledge.index", fencingToken: 1, currentStep: null, payload: run }

/** The effects port as a ledger in memory: every act is made (repeatable), settled keys are kept so a spec reads what was keyed and settled. */
const effectsOf = () => {
    const acts: Array<string> = []
    const settled: Array<{ readonly key: string; readonly result: unknown }> = []
    const effects: Effects = {
        once: async <T,>(key: string, _effect: unknown, call: { readonly act: () => Promise<T> }): Promise<T> => {
            acts.push(key)
            return call.act()
        },
        settleIn: (_tx, key, result) => {
            settled.push({ key, result })
            return Promise.resolve()
        },
    }
    return { effects, acts, settled }
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
    const ledger = effectsOf()
    sources.sourceOf.mockResolvedValue(source)
    reader.read.mockResolvedValue({ kind: "ok", value: { text: source?.content ?? "", title: null } })
    embeddings.configured.mockReturnValue(true)
    embeddings.model.mockReturnValue("m1")
    embeddings.embed.mockResolvedValue([[0.5, 1]])
    chunks.embeddedOf.mockResolvedValue([])
    chunks.replace.mockResolvedValue(true)
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
            { provide: EFFECTS, useValue: ledger.effects },
            { provide: JOB_PROGRESS, useValue: progress },
        ],
    }).compile()
    const service = moduleRef.get(KnowledgeIndexingService)
    return { service, sources, blocked, parts, chunks, reader, unchanged, embeddings, usage, logger, vectorSync, progress, ledger }
}

const registerSourceReadingCases = () => {
    it("stops after a duplicate is closed without indexing or embedding the same text again", async () => {
        const source = sourceOf({ kind: "url" })
        const { service, sources, reader, unchanged, chunks, embeddings } = await build(source)
        reader.read.mockResolvedValue({ kind: "ok", value: { text: "  Existing text  ", title: null } })
        unchanged.closeDuplicate.mockResolvedValue(true)
        await expect(service.index(run, JOB)).resolves.toBe("skipped")
        expect(reader.read).toHaveBeenCalledWith(source)
        expect(unchanged.closeDuplicate).toHaveBeenCalledWith(source, { first: "Existing text", later: [] })
        expect(sources.startIndexing).not.toHaveBeenCalled()
        expect([chunks.arrange.mock.calls, chunks.keep.mock.calls]).toEqual([[], []])
        expect(embeddings.embed).not.toHaveBeenCalled()
        expect(sources.finishIndexing).not.toHaveBeenCalled()
    })

    it("retains the reader's document places in stored vectors and reused passages", async () => {
        const { service, chunks, reader } = await build()
        const place = { kind: "page" as const, label: "2" }
        reader.read.mockResolvedValue({
            kind: "ok",
            value: {
                text: "Open 8 to 21",
                title: null,
                parts: [{ text: "Open 8 to 21", place }],
            },
        })

        await expect(service.index(run, JOB)).resolves.toBe("indexed")

        expect(chunks.place).toHaveBeenCalledWith({
            workspaceId: WS,
            sourceId: "s1",
            places: [{ order: 0, place }],
        })
        expect(chunks.keep).toHaveBeenCalledWith(
            expect.objectContaining({
                drafts: [{ text: "Open 8 to 21", embedded: true, order: 0, place }],
            }),
            expect.any(Function),
        )
    })

    it("hands each embedded batch's vectors to the vector index under the ids the passages were stored with; Postgres keeps none", async () => {
        const { service, chunks, vectorSync } = await build()

        await expect(service.index(run, JOB)).resolves.toBe("indexed")

        expect(chunks.keep.mock.calls.flatMap(([write]) => Object.keys(write))).not.toContain("vectorsInIndex")
        expect(vectorSync.accept).toHaveBeenCalledWith("passage", WS, new Map([["c0", [0.5, 1]]]))
    })

    it("writes the sync job of the document, the event that queues its facts and the status in ONE transaction (the finishing one)", async () => {
        const { service, sources, vectorSync } = await build()

        await service.index(run, JOB)

        const within = sources.finishIndexing.mock.calls[0]?.[4]
        expect(within).toEqual(expect.any(Function))
        const tx = Symbol("tx") as never
        await within?.(tx)
        expect(vectorSync.changedSource).toHaveBeenCalledWith(WS, "s1", tx)
    })

    it("skips a source that is gone and one that is past indexing or closed", async () => {
        await expect((await build(null)).service.index(run, JOB)).resolves.toBe("skipped")

        for (const status of ["ready", "extracting_facts", "failed", "blocked_credits"]) {
            const closed = await build(sourceOf({ status }))
            await expect(closed.service.index(run, JOB)).resolves.toBe("skipped")
            expect(closed.sources.begin).not.toHaveBeenCalled()
        }
    })
}

const registerIndexingProgressCases = () => {
    it("reads, embeds and stores a text source, then hands it on to the reading of its facts", async () => {
        const { service, sources, chunks, embeddings } = await build()

        await expect(service.index(run, JOB)).resolves.toBe("indexed")

        expect(sources.begin).toHaveBeenCalledWith(WS, "s1")
        expect(sources.startIndexing).toHaveBeenCalledWith(WS, "s1", "Open 8 to 21", "Hours")
        expect(embeddings.embed).toHaveBeenCalledWith({
            workspaceId: WS,
            texts: ["Open 8 to 21"],
            timeoutMs: 20_000,
        })
        expect(chunks.arrange).toHaveBeenCalledWith({ workspaceId: WS, sourceId: "s1", moves: [], count: 1 })
        expect(chunks.keep).toHaveBeenCalledWith(INDEXING_TEXT_WRITE, expect.any(Function))
        expect(sources.finishIndexing).toHaveBeenCalledWith(WS, "s1", null, 1, expect.any(Function))
    })

    it("U1: books every model call of the reading to the document (`source:<id>`), a first reading as `document_read`", async () => {
        const { service, embeddings } = await build()
        const scopes: Array<unknown> = []
        embeddings.embed.mockImplementation(() => {
            scopes.push(workInScope())
            return Promise.resolve([[0.5, 1]])
        })

        await service.index(run, JOB)

        expect(scopes).toEqual([expect.objectContaining({ kind: "document_read", ref: "source:s1" })])
        expect(workInScope()).toBeNull()
    })

    it("moves through the stages chunk, embed and store in order", async () => {
        const { service, sources } = await build()

        await service.index(run, JOB)

        expect(sources.enterStage.mock.calls.map(([, , change]) => change.stage)).toEqual(["chunk", "embed", "store"])
        expect(sources.enterStage).toHaveBeenCalledWith(WS, "s1", INDEXING_EMBED_STAGE)
        expect(sources.enterStage).toHaveBeenCalledWith(WS, "s1", INDEXING_STORE_STAGE)
    })
    it("takes the title the reader found", async () => {
        const { service, sources, reader } = await build()
        reader.read.mockResolvedValue({ kind: "ok", value: { text: " Page ", title: "Page title" } })

        await service.index(run, JOB)

        expect(sources.startIndexing).toHaveBeenCalledWith(WS, "s1", "Page", "Page title")
    })
}

const registerEmbeddingAndReuseCases = () => {
    it("embeds and stores the passages batch by batch and reports the count after each", async () => {
        const { service, chunks, embeddings, progress, ledger } = await build(sourceOf({ content: MANY }))
        embeddings.embed.mockImplementation((request) => Promise.resolve(request.texts.map(() => [1])))
        const total = chunkPassages(MANY).length

        await service.index(run, JOB)

        expect(embeddings.embed).toHaveBeenCalledTimes(Math.ceil(total / EMBED_BATCH))
        expect(chunks.keep).toHaveBeenCalledTimes(Math.ceil(total / EMBED_BATCH))
        expect(progress.report).toHaveBeenLastCalledWith(JOB, total, total, "knowledge.index.embed")
        // Every batch is an outside act keyed by the job and the order of its first passage, and settled with the passages it made.
        const firstOrders = Array.from({ length: Math.ceil(total / EMBED_BATCH) }, (_, index) => index * EMBED_BATCH)
        expect(ledger.acts.filter((key) => key.includes(":embed:"))).toEqual(firstOrders.map((order) => `job-1:embed:${String(order)}`))
        expect(ledger.settled.map((one) => one.key)).toEqual(firstOrders.map((order) => `job-1:embed:${String(order)}`))
    })
    it("fails the batch into the queue retry when the provider gives no vectors, storing nothing keyword-only", async () => {
        const { service, sources, chunks, embeddings } = await build()
        embeddings.embed.mockResolvedValue(null)

        await expect(service.index(run, JOB)).rejects.toMatchObject({ code: KnowledgeErrorCode.EmbeddingUnavailable })

        expect(chunks.keep).not.toHaveBeenCalled()
        expect(sources.finishIndexing).not.toHaveBeenCalled()
        expect(sources.fail).not.toHaveBeenCalled()
    })
    it("stores a passage the provider gave no vector for without one", async () => {
        const { service, chunks, embeddings } = await build()
        embeddings.embed.mockResolvedValue([])

        await service.index(run, JOB)

        expect(chunks.keep).toHaveBeenCalledWith(
            expect.objectContaining({ drafts: [{ text: "Open 8 to 21", embedded: false, order: 0 }] }),
            expect.any(Function),
        )
    })

    it("keeps the stored passages when they are already the embedded passages of the text", async () => {
        const { service, sources, chunks, embeddings } = await build()
        chunks.embeddedOf.mockResolvedValue([legacy("Open 8 to 21", 0)])

        await expect(service.index(run, JOB)).resolves.toBe("indexed")

        expect(embeddings.embed).not.toHaveBeenCalled()
        expect(chunks.keep).not.toHaveBeenCalled()
        expect(sources.finishIndexing).toHaveBeenCalledWith(WS, "s1", null, 1, expect.any(Function))
    })

    it.each(INDEXING_STALE_PASSAGES)("embeds again when the stored passages differ (%s)", async (_name, have) => {
        const { service, chunks, embeddings } = await build()
        chunks.embeddedOf.mockResolvedValue(have)

        await service.index(run, JOB)

        expect(embeddings.embed).toHaveBeenCalled()
    })

    it("K-9a: a document deleted while its passages were written ends the job `origin_gone`: the write found no source, nothing finishes, no vector is handed over", async () => {
        const { service, sources, chunks, vectorSync } = await build()
        chunks.keep.mockResolvedValue(null)

        await expect(service.index(run, JOB)).resolves.toBe("origin_gone")

        expect(sources.finishIndexing).not.toHaveBeenCalled()
        expect(vectorSync.accept).not.toHaveBeenCalled()
    })

    it("the keyword-only write of a document that was deleted meanwhile ends `origin_gone` too", async () => {
        const { service, sources, chunks, embeddings } = await build()
        embeddings.configured.mockReturnValue(false)
        chunks.replace.mockResolvedValue(false)

        await expect(service.index(run, JOB)).resolves.toBe("origin_gone")

        expect(sources.finishIndexing).not.toHaveBeenCalled()
    })

    it("stores keyword-only passages without looking when embeddings are not configured", async () => {
        const { service, sources, chunks, embeddings } = await build()
        embeddings.configured.mockReturnValue(false)

        await service.index(run, JOB)

        expect(chunks.embeddedOf).not.toHaveBeenCalled()
        expect(chunks.replace).toHaveBeenCalledWith(
            expect.objectContaining({ drafts: [{ text: "Open 8 to 21", embedded: false }] }),
        )
        expect(sources.finishIndexing).toHaveBeenCalledWith(WS, "s1", StoredNote.KeywordOnly, 1, expect.any(Function))
    })
}

const registerCreditBoundaryCases = () => {
    it("stores a large document without vectors and waits when the workspace has no credits left", async () => {
        const content = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ${"y".repeat(700)}`).join("\n\n")
        const { service, sources, usage, embeddings, chunks } = await build(sourceOf({ content }))
        usage.blockedBy.mockResolvedValue(true)

        await expect(service.index(run, JOB)).resolves.toBe("blocked")

        expect(usage.blockedBy).toHaveBeenCalledWith(WS, "embedding", true)
        expect(embeddings.embed).not.toHaveBeenCalled()
        expect(chunks.replace).not.toHaveBeenCalled()
        const drafts = chunks.keep.mock.calls.flatMap(([write]) => write.drafts)
        expect(drafts.length).toBe(chunkPassages(content).length)
        expect(drafts.every((draft) => !draft.embedded)).toBe(true)
        expect(sources.blockIndexing).toHaveBeenCalledWith(WS, "s1", StoredNote.NoCreditsForIndex, drafts.length, expect.any(Function))
        expect(sources.finishIndexing).not.toHaveBeenCalled()
    })
    it("keeps the vectors already paid for when a retry meets no credits, and stores only the missing passages", async () => {
        const { service, sources, usage, embeddings, chunks } = await build(sourceOf({ content: MANY }))
        const pieces = chunkPassages(MANY)
        chunks.embeddedOf.mockResolvedValue(pieces.slice(0, 10).map(stored))
        usage.blockedBy.mockResolvedValue(true)

        await expect(service.index(run, JOB)).resolves.toBe("blocked")

        expect(chunks.replace).not.toHaveBeenCalled()
        expect(embeddings.embed).not.toHaveBeenCalled()
        const orders = chunks.keep.mock.calls.flatMap(([write]) => write.drafts.map((draft) => draft.order))
        expect(orders).toEqual(pieces.map((_, order) => order).slice(10))
        expect(sources.blockIndexing).toHaveBeenCalledWith(WS, "s1", StoredNote.NoCreditsForIndex, pieces.length, expect.any(Function))
    })
    it("stores a SMALL document word-only and parks it too when the pool is empty: it never fails for want of credits (D-U-4)", async () => {
        // One passage: the pool is asked before the first call whatever the size (the pool is the only limit).
        const { service, sources, usage, embeddings, chunks } = await build()
        usage.blockedBy.mockResolvedValue(true)

        await expect(service.index(run, JOB)).resolves.toBe("blocked")

        expect(usage.blockedBy).toHaveBeenCalledWith(WS, "embedding", true)
        expect(embeddings.embed).not.toHaveBeenCalled()
        expect(chunks.keep.mock.calls.flatMap(([write]) => write.drafts)).toEqual([{ text: "Open 8 to 21", embedded: false, order: 0 }])
        expect(sources.blockIndexing).toHaveBeenCalledWith(WS, "s1", StoredNote.NoCreditsForIndex, 1, expect.any(Function))
        expect(sources.fail).not.toHaveBeenCalled()
        expect(sources.finishIndexing).not.toHaveBeenCalled()
    })
    it("the pool runs out BETWEEN two batches: the batches embedded keep their vectors, the rest is stored word-only, the document waits", async () => {
        const { service, sources, usage, embeddings, chunks } = await build(sourceOf({ content: MANY }))
        const pieces = chunkPassages(MANY)
        const firstBatch = pieces.slice(0, EMBED_BATCH).map(() => [0.5, 1])
        // Credits when the document starts; the second batch comes back with no vectors and the pool then says it is empty.
        usage.blockedBy.mockResolvedValueOnce(false).mockResolvedValue(true)
        embeddings.embed.mockResolvedValueOnce(firstBatch).mockResolvedValue(null)

        await expect(service.index(run, JOB)).resolves.toBe("blocked")

        const drafts = chunks.keep.mock.calls.flatMap(([write]) => write.drafts)
        expect(drafts.length).toBe(pieces.length)
        expect(drafts.slice(0, EMBED_BATCH).every((draft) => draft.embedded)).toBe(true)
        expect(drafts.slice(EMBED_BATCH).every((draft) => !draft.embedded)).toBe(true)
        // The provider is asked once more only; the pool is asked once at the start and once when a batch came back empty.
        expect(embeddings.embed).toHaveBeenCalledTimes(2)
        expect(usage.blockedBy).toHaveBeenCalledTimes(2)
        expect(sources.blockIndexing).toHaveBeenCalledWith(WS, "s1", StoredNote.NoCreditsForIndex, pieces.length, expect.any(Function))
        expect(sources.fail).not.toHaveBeenCalled()
    })
}

const registerCreditProviderCases = () => {
    it("a batch with no vectors while the pool HAS credits is the provider's failure: thrown for the queue to retry, nothing stored word-only", async () => {
        const { service, sources, embeddings, chunks } = await build()
        embeddings.embed.mockResolvedValue(null)

        await expect(service.index(run, JOB)).rejects.toMatchObject({ code: KnowledgeErrorCode.EmbeddingUnavailable })

        expect(chunks.keep).not.toHaveBeenCalled()
        expect(sources.blockIndexing).not.toHaveBeenCalled()
    })
    it("a file whose text needs a model call the empty pool refused waits for credits: it is not failed", async () => {
        const { service, sources, reader, chunks } = await build(sourceOf({ kind: "file" }))
        reader.read.mockResolvedValue({ kind: "refused", code: StoredNote.NoCreditsForTranscription })

        await expect(service.index(run, JOB)).resolves.toBe("blocked")

        expect(sources.blockIndexing).toHaveBeenCalledWith(WS, "s1", StoredNote.NoCreditsForTranscription, 0)
        expect(sources.fail).not.toHaveBeenCalled()
        expect(chunks.keep).not.toHaveBeenCalled()
    })
}

const registerSourceOutcomeCases = () => {
    it.each<[string, string, string]>(INDEXING_EMPTY_TEXTS)(
        "writes the stored note on the row and throws a typed refusal (class input) for a source with %s: the runner dead-letters it at once",
        async (_name, text, note) => {
            const { service, sources, reader } = await build()
            reader.read.mockResolvedValue({ kind: "ok", value: { text, title: null } })

            const thrown = await service.index(run, JOB).catch((cause: unknown) => cause)

            expect(thrown).toBeInstanceOf(KnowledgeError)
            expect(thrown).toMatchObject({ code: KnowledgeErrorCode.SourceRefused })
            expect(classifyFailure(thrown)).toBe("input")
            expect(sources.fail).toHaveBeenCalledWith(WS, "s1", note)
        },
    )

    it("keeps the first part of a text longer than a source may be and makes each later part a source", async () => {
        const { service, sources, parts, reader } = await build()
        const text = Array.from({ length: Math.ceil((MAX_SOURCE_CHARS * 1.5) / 11) }, () => "row | cell").join("\n")
        const [first = "", second = ""] = partsOf(text, MAX_SOURCE_CHARS)
        reader.read.mockResolvedValue({ kind: "ok", value: { text, title: null } })
        parts.splitLong.mockResolvedValue("Hours (1/2)")

        await expect(service.index(run, JOB)).resolves.toBe("indexed")

        expect(parts.splitLong).toHaveBeenCalledWith(WS, "s1", "Hours", [second])
        expect(sources.startIndexing).toHaveBeenCalledWith(WS, "s1", first, "Hours (1/2)")
        expect(sources.fail).not.toHaveBeenCalled()
    })

    it("writes the note of the reader's reason on the row and throws a refusal for a source the reader refuses: a dead letter at once, class input", async () => {
        const { service, sources, reader } = await build()
        reader.read.mockResolvedValue({ kind: "refused", code: StoredNote.FileMissing })

        const thrown = await service.index(run, JOB).catch((cause: unknown) => cause)

        expect(thrown).toMatchObject({ code: KnowledgeErrorCode.SourceRefused })
        expect(classifyFailure(thrown)).toBe("input")
        expect(sources.fail).toHaveBeenCalledWith(WS, "s1", StoredNote.FileMissing)
    })

    it("lets a page that can never be read throw as it is (class input) and no catch closes the source", async () => {
        const { service, sources, reader } = await build()
        const refused = new DocumentsError({ code: DocumentsErrorCode.NotPublic })
        reader.read.mockRejectedValue(refused)

        await expect(service.index(run, JOB)).rejects.toBe(refused)

        expect(classifyFailure(refused)).toBe("input")
        expect(sources.fail).not.toHaveBeenCalled()
    })
    it("throws a page or a storage that could not be reached as it is: the runner reads it as transient", async () => {
        const { service, sources, reader } = await build()
        const down = new DocumentsError({ code: DocumentsErrorCode.Unavailable })
        reader.read.mockRejectedValue(down)

        await expect(service.index(run, JOB)).rejects.toBe(down)
        expect(classifyFailure(down)).toBe("transient")

        const storage = new KnowledgeSourcesError({ code: KnowledgeSourcesErrorCode.UploadUnavailable })
        reader.read.mockRejectedValue(storage)
        await expect(service.index(run, JOB)).rejects.toBe(storage)
        expect(classifyFailure(storage)).toBe("transient")

        expect(sources.fail).not.toHaveBeenCalled()
    })

    it("throws any other failure as it is: the runner reads it as code, never stored as unreadable by a catch here", async () => {
        const { service, sources, reader } = await build()
        reader.read.mockRejectedValue(new Error("boom"))

        await expect(service.index(run, JOB)).rejects.toThrow("boom")

        expect(sources.fail).not.toHaveBeenCalled()
    })

    it("indexes a source the dead letter closed as failed when the job is RESUMED, and leaves it for a delivery that is not a resume", async () => {
        const failed = await build(sourceOf({ status: "failed" }))
        await expect(failed.service.index(run, JOB)).resolves.toBe("skipped")
        expect(failed.sources.begin).not.toHaveBeenCalled()

        const resumed = await build(sourceOf({ status: "failed" }))
        await expect(resumed.service.index(run, { ...JOB, resumeCount: 1 })).resolves.toBe("indexed")
        expect(resumed.sources.begin).toHaveBeenCalledWith(WS, "s1")
    })
}

describe("KnowledgeIndexingService", () => {
    describe("index", () => {
        registerSourceReadingCases()

        registerIndexingProgressCases()

        registerEmbeddingAndReuseCases()

        registerCreditBoundaryCases()

        registerCreditProviderCases()

        registerSourceOutcomeCases()
    })

    describe("a text the source holds whole", () => {
        it.each(INDEXING_WHOLE_SOURCE_KINDS)("skips a %s, reading only what can change", async (kind, reads) => {
            const { service, reader, unchanged } = await build(sourceOf({ kind }))
            unchanged.holdsWhole.mockResolvedValue(true)

            await expect(service.index(run, JOB)).resolves.toBe("skipped")

            expect(reader.read).toHaveBeenCalledTimes(reads)
        })
    })

    describe("failSource", () => {
        it("closes an open source with the stored code of the dead letter's reason, unreadable when it is no code the page words; one already failed keeps its note", async () => {
            const { service, sources } = await build()

            await service.failSource(WS, "s1", DocumentsErrorCode.Unavailable)
            await service.failSource(WS, "s1", StoredNote.FileMissing)
            await service.failSource(WS, "s1", "something else")
            await service.failSource(WS, "s1", undefined)

            expect(sources.fail.mock.calls.map(([, , note]) => note)).toEqual([
                DocumentsErrorCode.Unavailable,
                StoredNote.FileMissing,
                StoredNote.Unreadable,
                StoredNote.Unreadable,
            ])

            sources.fail.mockClear()
            sources.sourceOf.mockResolvedValue(sourceOf({ status: "failed" }))
            await service.failSource(WS, "s1", DocumentsErrorCode.Unavailable)
            expect(sources.fail).not.toHaveBeenCalled()
        })
    })

    describe("sourceForFacts", () => {
        it("gives the source whose passages are stored, and nothing otherwise", async () => {
            const ready = await build(sourceOf({ status: "ready" }))
            await expect(ready.service.sourceForFacts(WS, "s1")).resolves.toMatchObject({ id: "s1" })

            const earlier = await build(sourceOf({ status: "extracting_facts" }))
            await expect(earlier.service.sourceForFacts(WS, "s1")).resolves.toMatchObject({ id: "s1" })

            const other = await build(sourceOf({ status: "indexing" }))
            await expect(other.service.sourceForFacts(WS, "s1")).resolves.toBeNull()

            const gone = await build(null)
            await expect(gone.service.sourceForFacts(WS, "s1")).resolves.toBeNull()
        })
    })
})
