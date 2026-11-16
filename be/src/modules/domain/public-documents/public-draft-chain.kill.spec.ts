import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { UsageMeterService } from "@modules/domain/knowledge"
import { KnowledgeSourcesReadService } from "@modules/domain/knowledge-sources"
import { AI } from "@modules/integrations/ai"
import type { AiChatAnswer, AiService } from "@modules/integrations/ai"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { aiChainProviders, aiKilled, claimedAiJob } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { WS, brainDocumentOf, documentRow, documentSourceRow, publicDraftingAnswers } from "@tests/fixtures/builders/public-documents.builder"
import { InternalReaderService } from "./internal-reader.service"
import { PublicDocumentEntity } from "./persistence/entities"
import { PublicDraftRunService } from "./public-draft-run.service"
import { PublicDraftWriterService } from "./public-draft-writer.service"

const REPAIR = "Flat tyre repair while you wait."
const READING = { answers: true, body: "Flat tyres are repaired while you wait." }
const ANSWER: AiChatAnswer = {
    text: JSON.stringify(READING),
    parsed: READING,
    model: "m1",
    usage: { promptTokens: 300, completionTokens: 90, totalTokens: 390, costUsd: null },
    retrieved: 0,
}

describe("public draft chain: the job is run twice, the second run asks the model for no second text", () => {
    it("a kill after the model wrote the text and before the row was written: the second run answers from the ledger, writes the row once and books the model once", async () => {
        const chain = aiChainProviders()
        const row = documentRow({ status: "drafting", body: "", instructions: "Keep it short" })
        const tx = fakeTransaction(mockEntityManager(publicDraftingAnswers(row, [documentSourceRow({ sourceId: "s1", sourceTitle: "old", contentHash: "old" })])))
        const shelf = [brainDocumentOf({ id: "s1", title: "Document s1", contentHash: "h-s1", content: REPAIR, visibility: "public" })]
        const sources = mock<KnowledgeSourcesReadService>()
        sources.statesOf.mockImplementation((_ws, ids) =>
            Promise.resolve(shelf.filter((doc) => ids.includes(doc.id)).map(({ id, title, visibility, status, contentHash }) => ({ id, title, visibility, status, contentHash }))),
        )
        sources.textOf.mockImplementation((_ws, id) => Promise.resolve(shelf.find((doc) => doc.id === id) ?? null))
        const ai = mock<AiService>()
        ai.attempt.mockResolvedValue({ ok: true, answer: ANSWER })
        const usage = mock<UsageMeterService>()
        usage.blockedBy.mockResolvedValue(false)
        const moduleRef = await Test.createTestingModule({
            providers: [
                ...chain.providers,
                PublicDraftRunService,
                PublicDraftWriterService,
                { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
                { provide: InternalReaderService, useValue: mock<InternalReaderService>() },
                { provide: KnowledgeSourcesReadService, useValue: sources },
                { provide: UsageMeterService, useValue: usage },
                { provide: AI, useValue: ai },
                { provide: LOGGER, useValue: mock<Logger>() },
            ],
        }).compile()
        const run = moduleRef.get(PublicDraftRunService)
        const job = claimedAiJob({ documentId: "d1", workspaceId: WS, draftRevision: 0 }, { kind: "public.draft" })
        // The worker is gone when it writes the row (the transaction never runs).
        tx.em.transaction.mockRejectedValueOnce(aiKilled())

        await expect(run.generate(job)).rejects.toMatchObject({ code: "ECONNRESET" })

        expect(ai.attempt).toHaveBeenCalledTimes(1)
        expect(chain.ledger.settled()).toEqual(["job-1:draft"])
        expect(usage.record).toHaveBeenCalledTimes(1)

        await expect(run.generate(job)).resolves.toBe("done")

        // The model was not asked again and is booked once; the document was written once from the kept text.
        expect(ai.attempt).toHaveBeenCalledTimes(1)
        expect(usage.record).toHaveBeenCalledTimes(1)
        expect(tx.em.update).toHaveBeenCalledWith(
            PublicDocumentEntity,
            { id: "d1", workspaceId: WS, status: "drafting", draftRevision: 0 },
            { body: READING.body, leftOut: [], status: "draft", failureCode: null, draftRevision: 1 },
        )
    })
})
