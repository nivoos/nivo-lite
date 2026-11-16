import { Test } from "@nestjs/testing"
import { In } from "typeorm"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { UsageMeterService } from "@modules/domain/knowledge"
import { KnowledgeSourcesReadService } from "@modules/domain/knowledge-sources"
import { AI } from "@modules/integrations/ai"
import type { AiChatAnswer, AiService } from "@modules/integrations/ai"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import type { QueueDelivery } from "@modules/platform/queue"
import { DRAFT_PUBLIC_DOCUMENT_JOB } from "@modules/queues/knowledge"
import { aiChainProviders, aiDeliveryOf, aiRunnerHarness } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { WS, brainDocumentOf, documentRow, documentSourceRow, publicDraftingAnswers } from "@tests/fixtures/builders/public-documents.builder"
import { PublicDocumentsErrorCode } from "./errors/public-documents.error"
import { InternalReaderService } from "./internal-reader.service"
import { PublicDocumentEntity } from "./persistence/entities"
import { PublicDraftRunService } from "./public-draft-run.service"
import { PublicDraftWriterService } from "./public-draft-writer.service"

const PAYLOAD = { documentId: "d1", workspaceId: WS, draftRevision: 0 }
const REPAIR = "Flat tyre repair while you wait."
const READING = { answers: true, body: "Flat tyres are repaired while you wait." }
const ANSWER: AiChatAnswer = {
    text: JSON.stringify(READING),
    parsed: READING,
    model: "m1",
    usage: { promptTokens: 300, completionTokens: 90, totalTokens: 390, costUsd: null },
    retrieved: 0,
}

/** The processor of the draft job as the feature composes it: one domain method; the dead letter closes the draft's row. */
class DraftProcessor extends FencedProcessor {
    override readonly queue = "knowledge"
    override readonly definition = DRAFT_PUBLIC_DOCUMENT_JOB
    constructor(private readonly drafts: PublicDraftRunService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.drafts.generate(job)
    }
    override async onFailed(delivery: QueueDelivery): Promise<void> {
        await this.drafts.fail(delivery.payload)
    }
}

const build = async (row = documentRow({ status: "drafting", body: "", gapId: null })) => {
    const chain = aiChainProviders()
    const tx = fakeTransaction(mockEntityManager(publicDraftingAnswers(row, [documentSourceRow({ sourceId: "s1", sourceTitle: "old", contentHash: "old" })])))
    const shelf = [brainDocumentOf({ id: "s1", title: "Document s1", contentHash: "h-s1", content: REPAIR, visibility: "public" })]
    const sources = mock<KnowledgeSourcesReadService>()
    sources.statesOf.mockImplementation((_ws, ids) =>
        Promise.resolve(shelf.filter((doc) => ids.includes(doc.id)).map(({ id, title, visibility, status, contentHash }) => ({ id, title, visibility, status, contentHash }))),
    )
    sources.textOf.mockImplementation((_ws, id) => Promise.resolve(shelf.find((doc) => doc.id === id) ?? null))
    const ai = mock<AiService>()
    ai.attempt.mockResolvedValue({ ok: true, answer: ANSWER })
    const reader = mock<InternalReaderService>()
    const usage = mock<UsageMeterService>()
    usage.blockedBy.mockResolvedValue(false)
    const moduleRef = await Test.createTestingModule({
        providers: [
            ...chain.providers,
            PublicDraftRunService,
            PublicDraftWriterService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: InternalReaderService, useValue: reader },
            { provide: KnowledgeSourcesReadService, useValue: sources },
            { provide: UsageMeterService, useValue: usage },
            { provide: AI, useValue: ai },
            { provide: LOGGER, useValue: mock<Logger>() },
        ],
    }).compile()
    return { processor: new DraftProcessor(moduleRef.get(PublicDraftRunService)), tx, ai, reader }
}

describe("public draft chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("the model is unavailable on every start: 1 / 2 / 4 / 8 min, then ONE item and the row says the draft could not be made; a resume opens it and drafts", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        h.claimed(PAYLOAD)
        t.ai.attempt.mockResolvedValue({ ok: false, failure: "timeout" })

        for (const attempt of [1, 2, 3, 4]) {
            await expect(h.runner.run(t.processor, aiDeliveryOf("knowledge", DRAFT_PUBLIC_DOCUMENT_JOB.name, PAYLOAD, attempt))).rejects.toMatchObject({
                code: "QUEUE_RETRY_AFTER",
                params: { seconds: [60, 120, 240, 480][attempt - 1] },
            })
        }
        expect(h.claims.park).not.toHaveBeenCalled()

        await h.runner.run(t.processor, aiDeliveryOf("knowledge", DRAFT_PUBLIC_DOCUMENT_JOB.name, PAYLOAD, 5))

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "knowledge" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        // The row says failed with the stored code (nothing deleted): the owner reads it and the dead letter's card says why.
        expect(t.tx.em.update).toHaveBeenCalledWith(
            PublicDocumentEntity,
            { id: "d1", workspaceId: WS, status: "drafting", draftRevision: 0 },
            { status: "failed", failureCode: PublicDocumentsErrorCode.DraftUnavailable },
        )
        expect(t.tx.em.delete).not.toHaveBeenCalled()

        // The cause is fixed and a person presses "run again": the job opens the row and drafts it.
        const resumed = await aiRunnerHarness(1)
        resumed.claimed(PAYLOAD)
        t.ai.attempt.mockResolvedValue({ ok: true, answer: ANSWER })

        await resumed.runner.run(t.processor, aiDeliveryOf("knowledge", DRAFT_PUBLIC_DOCUMENT_JOB.name, PAYLOAD, 1))

        expect(t.tx.em.update).toHaveBeenCalledWith(
            PublicDocumentEntity,
            { id: "d1", workspaceId: WS, status: In(["failed", "published"]), draftRevision: 0, failureCode: PublicDocumentsErrorCode.DraftUnavailable },
            { status: "drafting", failureCode: null },
        )
        expect(t.tx.em.update).toHaveBeenCalledWith(
            PublicDocumentEntity,
            { id: "d1", workspaceId: WS, status: "drafting", draftRevision: 0 },
            { body: READING.body, leftOut: [], status: "draft", failureCode: null, draftRevision: 1 },
        )
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.claims.park).not.toHaveBeenCalled()
    })

    it("a gap draft the model refuses is not deleted any more: the job parks at once (input) with ONE item and the proposal stays as a failed row", async () => {
        const t = await build(documentRow({ status: "drafting", body: "", gapId: "g1", question: "Do you repair wheels?" }))
        const h = await aiRunnerHarness()
        h.claimed(PAYLOAD)
        t.reader.hits.mockResolvedValue({ kind: "ok", sourceIds: ["s1"] })
        t.ai.attempt.mockResolvedValue({ ok: true, answer: { ...ANSWER, parsed: null, text: "not json" } })

        await h.runner.run(t.processor, aiDeliveryOf("knowledge", DRAFT_PUBLIC_DOCUMENT_JOB.name, PAYLOAD, 1))

        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: PublicDocumentsErrorCode.DraftRefused }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.tx.em.update).toHaveBeenCalledWith(
            PublicDocumentEntity,
            { id: "d1", workspaceId: WS, status: "drafting", draftRevision: 0 },
            { status: "failed", failureCode: PublicDocumentsErrorCode.DraftUnavailable },
        )
        expect(t.tx.em.delete).not.toHaveBeenCalled()
    })
})
