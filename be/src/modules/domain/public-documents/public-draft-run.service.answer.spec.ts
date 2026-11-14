import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { UsageMeterService } from "@modules/domain/knowledge"
import { KnowledgeSourcesReadService } from "@modules/domain/knowledge-sources"
import type { SourceDocument } from "@modules/domain/knowledge-sources"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { claimedAiJob } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import {
    WS,
    brainDocumentOf,
    documentRow,
    documentSourceRow,
    publicDraftingAnswers,
} from "@tests/fixtures/builders/public-documents.builder"
import { PublicDocumentsErrorCode } from "./errors/public-documents.error"
import { InternalReaderService } from "./internal-reader.service"
import type { HitsOutcome } from "./internal-reader.service"
import { PublicDocumentEntity, PublicDocumentSourceEntity } from "./persistence/entities"
import { PublicDraftRunService } from "./public-draft-run.service"
import { PublicDraftWriterService } from "./public-draft-writer.service"

const codes = PublicDocumentsErrorCode
const payload = { documentId: "d1", workspaceId: WS, draftRevision: 0 }

/** The claimed job of the draft: its id keys the model call (`job-1:draft`). */
const JOB = claimedAiJob(payload, { kind: "public.draft" })

/** A document NIVO is drafting, with no text yet. The owner's draft is specified in `public-draft-run.service.spec.ts`. */
const rowOf = (changes: Parameters<typeof documentRow>[0] = {}) =>
    documentRow({ status: "drafting", body: "", instructions: "Keep it short", ...changes })
const sourceRow = (sourceId: string) => documentSourceRow({ sourceId, sourceTitle: "old", contentHash: "old" })
/** A ready document of a bicycle workshop's Brain (synthetic data), in the public area unless named otherwise. */
const docOf = (id: string, content: string, visibility = "public"): SourceDocument =>
    brainDocumentOf({ id, title: `Document ${id}`, contentHash: `h-${id}`, content, visibility })

const build = async (em: MockEntityManager, shelf: ReadonlyArray<SourceDocument> = []) => {
    const reader = mock<InternalReaderService>()
    const sources = mock<KnowledgeSourcesReadService>()
    sources.statesOf.mockImplementation((_ws, ids) =>
        Promise.resolve(
            shelf
                .filter((doc) => ids.includes(doc.id))
                .map(({ id, title, visibility, status, contentHash }) => ({ id, title, visibility, status, contentHash })),
        ),
    )
    sources.textOf.mockImplementation((_ws, id) => Promise.resolve(shelf.find((doc) => doc.id === id) ?? null))
    const writer = mock<PublicDraftWriterService>()
    const usage = mock<UsageMeterService>()
    usage.blockedBy.mockResolvedValue(false)
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            PublicDraftRunService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: InternalReaderService, useValue: reader },
            { provide: KnowledgeSourcesReadService, useValue: sources },
            { provide: PublicDraftWriterService, useValue: writer },
            { provide: UsageMeterService, useValue: usage },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { run: moduleRef.get(PublicDraftRunService), reader, sources, writer, usage, logger }
}

/** A transaction over a manager that finds the drafting row and its sources. */
const drafting = (row: PublicDocumentEntity, sources: ReadonlyArray<PublicDocumentSourceEntity> = []) =>
    fakeTransaction(mockEntityManager(publicDraftingAnswers(row, sources)))

const stopped = (code: string, status = "failed") => [
    PublicDocumentEntity,
    { id: "d1", workspaceId: WS, status: "drafting", draftRevision: 0 },
    { status, failureCode: code },
]

const question = "Can you true a wheel by tomorrow?"
const proposal = rowOf({ kind: "answer", gapId: "g1", question, title: question, instructions: null })
const hits = (...ids: Array<string>): HitsOutcome => ({ kind: "ok", sourceIds: ids })

describe("PublicDraftRunService the answer to a customer question", () => {
    it("reads only the public-area documents among those found, and records them as the proposal's sources", async () => {
        const tx = drafting(proposal)
        const shelf = [
            docOf("s1", "Wheel truing in one day."),
            docOf("s2", "Mechanic pay rises in May.", "internal"),
            docOf("s3", "Helmets for rent."),
        ]
        const { run, reader, sources, writer } = await build(tx.em, shelf)
        reader.hits.mockResolvedValue(hits("s1", "s2", "s3"))
        writer.write.mockResolvedValue({ answers: true, body: "Yes, wheels are trued in one day." })

        await expect(run.generate(JOB)).resolves.toBe("done")

        expect(reader.hits).toHaveBeenCalledWith(WS, question)
        expect(sources.textOf.mock.calls.map(([, id]) => id)).toEqual(["s1", "s3"])
        expect(writer.write).toHaveBeenCalledTimes(1)
        expect(writer.write).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: WS,
            title: question,
            question,
            instructions: null,
            sources: [
                { sourceId: "s1", title: "Document s1", text: "Wheel truing in one day.", cut: false },
                { sourceId: "s3", title: "Document s3", text: "Helmets for rent.", cut: false },
            ],
        }), "job-1:draft")
        expect(JSON.stringify(writer.write.mock.calls)).not.toContain("Mechanic pay")
        expect(tx.em.insert).toHaveBeenCalledWith(PublicDocumentSourceEntity, [
            { documentId: "d1", sourceId: "s1", workspaceId: WS, sourceTitle: "Document s1", contentHash: "h-s1" },
            { documentId: "d1", sourceId: "s3", workspaceId: WS, sourceTitle: "Document s3", contentHash: "h-s3" },
        ])
        expect(tx.em.update).toHaveBeenCalledWith(
            PublicDocumentEntity,
            { id: "d1", workspaceId: WS, status: "drafting", draftRevision: 0 },
            {
                title: question,
                body: "Yes, wheels are trued in one day.",
                leftOut: [],
                status: "draft",
                failureCode: null,
                draftRevision: 1,
            },
        )
        expect(tx.em.delete.mock.calls).toEqual([[PublicDocumentSourceEntity, { documentId: "d1", workspaceId: WS }]])
    })

    it.each<readonly [string, HitsOutcome]>([
        ["no agent may search", { kind: "no_right" }],
        ["the search was refused", { kind: "refused", code: "tool_error" }],
        ["the search found no document", hits()],
    ])("leaves the proposal failed with the typed code of why, and deletes nothing, when %s", async (_name, outcome) => {
        const tx = drafting(proposal)
        const { run, reader, writer } = await build(tx.em)
        reader.hits.mockResolvedValue(outcome)

        await run.generate(JOB)

        const code = outcome.kind === "no_right" ? codes.NoInternalRight : outcome.kind === "ok" ? codes.NothingLeft : codes.DraftUnavailable
        expect(tx.em.update).toHaveBeenCalledWith(...stopped(code))
        expect(tx.em.delete).not.toHaveBeenCalled()
        expect(writer.write).not.toHaveBeenCalled()
    })
})

describe("PublicDraftRunService a proposal the documents do not answer", () => {
    it.each([
        { answers: false, body: "" },
        { answers: false, body: "Wheels are trued." },
        { answers: true, body: " " },
    ])("leaves the proposal failed with NothingLeft when the model answers %j: no word of the question is compared", async (answer) => {
        const tx = drafting(proposal)
        // The document repeats every word of the question; only the model's answer decides.
        const { run, reader, writer } = await build(tx.em, [docOf("s1", question)])
        reader.hits.mockResolvedValue(hits("s1"))
        writer.write.mockResolvedValue(answer)

        await run.generate(JOB)

        expect(writer.write).toHaveBeenCalledTimes(1)
        expect(tx.em.update).toHaveBeenCalledWith(...stopped(codes.NothingLeft))
        expect(tx.em.delete).not.toHaveBeenCalled()
        expect(tx.em.insert).not.toHaveBeenCalled()
    })

    it("writes from a document that shares no word with the question when the model says it answers", async () => {
        const tx = drafting(proposal)
        const { run, reader, writer } = await build(tx.em, [docOf("s1", "Rims straightened overnight.")])
        reader.hits.mockResolvedValue(hits("s1"))
        writer.write.mockResolvedValue({ answers: true, body: "Yes, overnight." })

        await run.generate(JOB)

        expect(tx.em.insert).toHaveBeenCalledWith(PublicDocumentSourceEntity, [expect.objectContaining({ sourceId: "s1" })])
    })
})

describe("PublicDraftRunService a proposal with no public document to read", () => {
    it.each<readonly [string, ReadonlyArray<SourceDocument>]>([
        ["every document found is of the internal area", [docOf("s1", "Wheel truing in one day.", "internal")]],
        ["the area of the document found cannot be read", [docOf("s1", "Wheel truing in one day.", "")]],
        ["the document found is gone", []],
        ["the document found is not fully read", [brainDocumentOf({ status: "indexing" })]],
    ])("leaves the proposal failed with NothingLeft, without the model, when %s", async (_name, shelf) => {
        const tx = drafting(proposal)
        const { run, reader, writer } = await build(tx.em, shelf)
        reader.hits.mockResolvedValue(hits("s1"))

        await run.generate(JOB)

        expect(writer.write).not.toHaveBeenCalled()
        expect(tx.em.update).toHaveBeenCalledWith(...stopped(codes.NothingLeft))
        expect(tx.em.delete).not.toHaveBeenCalled()
    })
})

describe("PublicDraftRunService a proposal that writes nothing", () => {
    it.each([null, "Approved answer"])(
        "does not replace working provenance when the model throws or says nothing answers; published=%s",
        async (publishedBody) => {
            const tx = drafting({ ...proposal, publishedBody })
            const { run, reader, writer } = await build(tx.em, [docOf("s1", "Wheel truing in one day.")])
            reader.hits.mockResolvedValue(hits("s1"))

            writer.write.mockRejectedValueOnce(new Error("outage"))
            await expect(run.generate(JOB)).rejects.toThrow("outage")
            writer.write.mockResolvedValueOnce({ answers: false, body: "" })
            await run.generate(JOB)

            // Nothing is ever deleted: the second end is a typed stop (a failed row, or a published one that stays published).
            expect(tx.em.delete).not.toHaveBeenCalled()
            expect(tx.em.insert).not.toHaveBeenCalled()
        },
    )

    it("falls back to the title when the proposal has no question text", async () => {
        const tx = drafting(rowOf({ gapId: "g1", question: null, title: question }))
        const { run, reader } = await build(tx.em)
        reader.hits.mockResolvedValue(hits())

        await run.generate(JOB)

        expect(reader.hits).toHaveBeenCalledWith(WS, question)
    })
})

describe("PublicDraftRunService a published answer redraft", () => {
    it("retains the approved owner row and public snapshot when the Brain can no longer be searched", async () => {
        const tx = drafting(
            rowOf({ kind: "answer", gapId: "g1", question, publishedBody: "Approved answer", publishedRevision: 0 }),
        )
        const { run, reader } = await build(tx.em)
        reader.hits.mockResolvedValue({ kind: "no_right" })

        await run.generate(JOB)

        expect(tx.em.delete).not.toHaveBeenCalled()
        expect(tx.em.update).toHaveBeenCalledWith(...stopped(codes.NoInternalRight, "published"))
    })

    it("stops as draft unavailable, never as a source not ready, when the search itself was refused (an infrastructure refusal)", async () => {
        const tx = drafting(
            rowOf({ kind: "answer", gapId: "g1", question, publishedBody: "Approved answer", publishedRevision: 0 }),
        )
        const { run, reader } = await build(tx.em)
        reader.hits.mockResolvedValue({ kind: "refused", code: "unknown_tool" })

        await run.generate(JOB)

        expect(tx.em.delete).not.toHaveBeenCalled()
        expect(tx.em.update).toHaveBeenCalledWith(...stopped(codes.DraftUnavailable, "published"))
    })

    it("replaces the working provenance in the guarded transaction rather than inserting duplicate source keys", async () => {
        const tx = drafting(
            rowOf({ kind: "answer", gapId: "g1", question, publishedBody: "Approved answer", publishedRevision: 0 }),
            [sourceRow("s1")],
        )
        const { run, reader, writer } = await build(tx.em, [docOf("s1", "Wheel truing in one day.")])
        reader.hits.mockResolvedValue(hits("s1"))
        writer.write.mockResolvedValue({ answers: true, body: "Wheels are trued in one day." })

        await run.generate(JOB)

        expect(tx.em.delete).toHaveBeenCalledWith(PublicDocumentSourceEntity, { documentId: "d1", workspaceId: WS })
        expect(tx.em.insert).toHaveBeenCalledWith(PublicDocumentSourceEntity, expect.anything())
        expect(tx.em.update).toHaveBeenCalledWith(
            PublicDocumentEntity,
            { id: "d1", workspaceId: WS, status: "drafting", draftRevision: 0 },
            expect.objectContaining({ status: "published", draftRevision: 1 }),
        )
        expect(tx.commits).toBe(1)
    })
})

describe("PublicDraftRunService concurrent answer jobs", () => {
    it.each([0, undefined])(
        "keeps answer evidence intact when the revision fence affects %s rows",
        async (affected) => {
            const tx = drafting(proposal)
            const { run, reader, writer } = await build(tx.em, [docOf("s1", "Wheel truing in one day.")])
            reader.hits.mockResolvedValue(hits("s1"))
            writer.write.mockResolvedValue({ answers: true, body: "Trued in one day." })
            tx.em.update.mockResolvedValueOnce({
                ...(affected === undefined ? {} : { affected }),
                raw: [],
                generatedMaps: [],
            })
            await expect(run.generate(JOB)).resolves.toBe("done")
            expect(tx.em.delete).not.toHaveBeenCalled()
            expect(tx.em.insert).not.toHaveBeenCalled()
            expect(tx.em.update).toHaveBeenCalledTimes(1)
        },
    )

    it("stops a proposal only while its revision still drafts: a later redraft is left as it is", async () => {
        const tx = drafting(proposal)
        const { run, reader } = await build(tx.em)
        reader.hits.mockResolvedValue({ kind: "no_right" })

        await run.generate(JOB)

        expect(tx.em.update).toHaveBeenCalledWith(...stopped(codes.NoInternalRight))
        expect(tx.em.delete).not.toHaveBeenCalled()
    })
})
