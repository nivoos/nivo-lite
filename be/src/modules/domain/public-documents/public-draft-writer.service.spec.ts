import { Test } from "@nestjs/testing"
import { builder, mock } from "@starci/jest-preset"
import { UsageMeterService } from "@modules/domain/knowledge"
import { AI } from "@modules/integrations/ai"
import type { AiChatAnswer, AiService } from "@modules/integrations/ai"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { classifyFailure } from "@modules/platform/queue"
import { aiChainProviders } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { DRAFT_SYSTEM_PROMPT, PUBLIC_DRAFT_PROMPT_VERSION, draftPrompt } from "./draft-prompt.policy"
import { DRAFT_OUTPUT_SCHEMA } from "./draft-answer.policy"
import { DRAFT_READ_SCHEMA } from "./draft.schema"
import { PublicDocumentsErrorCode } from "./errors/public-documents.error"
import { PublicDraftWriterService } from "./public-draft-writer.service"
import type { PublicDraftBrief } from "./public-documents.contracts"

const WS = "11111111-1111-4111-8111-111111111111"
const KEY = "job-1:draft"
/** A laundry's public document. */
const brief: PublicDraftBrief = {
    workspaceId: WS,
    title: "Services",
    question: null,
    instructions: null,
    sources: [
        { sourceId: "s1", title: "Price list", text: "Wash and fold in 24 hours.", cut: false },
    ],
}
const READING = { answers: true, body: "Wash and fold is ready in 24 hours." }
const answerOf = builder<AiChatAnswer>({
    text: JSON.stringify(READING),
    parsed: READING,
    model: "m1",
    usage: { promptTokens: 300, completionTokens: 90, totalTokens: 390, costUsd: null },
    retrieved: 0,
})

const build = async () => {
    const ai = mock<AiService>()
    const usage = mock<UsageMeterService>()
    usage.blockedBy.mockResolvedValue(false)
    const logger = mock<Logger>()
    const chain = aiChainProviders()
    const moduleRef = await Test.createTestingModule({
        providers: [
            ...chain.providers,
            PublicDraftWriterService,
            { provide: AI, useValue: ai },
            { provide: UsageMeterService, useValue: usage },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { writer: moduleRef.get(PublicDraftWriterService), ai, usage, logger, ledger: chain.ledger }
}

describe("PublicDraftWriterService", () => {
    it("asks the model once with the prompt, the read schema and the closed structured output, under the job's key, and answers its answer", async () => {
        const { writer, ai, logger, ledger } = await build()
        ai.attempt.mockResolvedValue({ ok: true, answer: answerOf() })

        await expect(writer.write(brief, KEY)).resolves.toEqual(READING)

        expect(ai.attempt).toHaveBeenCalledTimes(1)
        expect(ai.attempt).toHaveBeenCalledWith({
            messages: [
                { role: "system", content: DRAFT_SYSTEM_PROMPT },
                { role: "user", content: draftPrompt(brief) },
            ],
            json: true,
            schema: DRAFT_READ_SCHEMA,
            outputSchema: DRAFT_OUTPUT_SCHEMA,
            timeoutMs: 90_000,
            context: null,
        })
        expect(ledger.keys()).toEqual([KEY])
        expect(logger.info).toHaveBeenCalledWith("public_documents.draft.read", {
            promptVersion: PUBLIC_DRAFT_PROMPT_VERSION,
            answers: true,
            bodyChars: READING.body.length,
        })
    })

    it("records the usage under the kind brain and the module public_documents", async () => {
        const { writer, ai, usage } = await build()
        ai.attempt.mockResolvedValue({ ok: true, answer: answerOf() })

        await writer.write(brief, KEY)

        expect(usage.record).toHaveBeenCalledWith({
            workspaceId: WS,
            kind: "brain",
            module: "public_documents",
            model: "m1",
            usage: { promptTokens: 300, completionTokens: 90, totalTokens: 390, costUsd: null },
            promptChars: DRAFT_SYSTEM_PROMPT.length + draftPrompt(brief).length,
            completionChars: JSON.stringify(READING).length,
            tryNumber: 1,
        })
    })

    it("reads the JSON out of the text when the structured answer is missing", async () => {
        const { writer, ai } = await build()
        ai.attempt.mockResolvedValue({
            ok: true,
            answer: answerOf({ parsed: null, text: `Here:\n\`\`\`json\n${JSON.stringify(READING)}\n\`\`\`` }),
        })

        await expect(writer.write(brief, KEY)).resolves.toEqual(READING)
    })
})

describe("PublicDraftWriterService: a model that did not answer throws a typed failure, never a value", () => {
    it.each(["timeout", "provider"] as const)("throws the transient DraftUnavailable on %s: the job's ladder retries it", async (failure) => {
        const { writer, ai } = await build()
        ai.attempt.mockResolvedValue({ ok: false, failure })

        const thrown = await writer.write(brief, KEY).catch((cause: unknown) => cause)

        expect(thrown).toMatchObject({ code: PublicDocumentsErrorCode.DraftUnavailable })
        expect(classifyFailure(thrown)).toBe("transient")
        expect(ai.attempt).toHaveBeenCalledTimes(1)
    })

    it("throws a config failure when no endpoint is configured", async () => {
        const { writer, ai } = await build()
        ai.attempt.mockResolvedValue({ ok: false, failure: "unconfigured" })

        const thrown = await writer.write(brief, KEY).catch((cause: unknown) => cause)

        expect(thrown).toMatchObject({ code: PublicDocumentsErrorCode.DraftUnconfigured })
        expect(classifyFailure(thrown)).toBe("config")
    })

    it.each(["no json here", "{ not json }", '{"usable":[1],"excluded":[],"paragraphs":[]}', '{"answers":"yes","body":"x"}'])(
        "throws the refusal DraftRefused (input: a dead letter, never a retry) on an answer that does not fit, and never calls a second time: %s",
        async (text) => {
            const { writer, ai, logger } = await build()
            ai.attempt.mockResolvedValue({ ok: true, answer: answerOf({ parsed: null, text }) })

            const thrown = await writer.write(brief, KEY).catch((cause: unknown) => cause)

            expect(thrown).toMatchObject({ code: PublicDocumentsErrorCode.DraftRefused })
            expect(classifyFailure(thrown)).toBe("input")
            expect(ai.attempt).toHaveBeenCalledTimes(1)
            expect(logger.warn).toHaveBeenCalledWith("public_documents.answer.unreadable", { promptVersion: PUBLIC_DRAFT_PROMPT_VERSION })
        },
    )

    it("throws the refusal for a cut answer and books what it spent, once", async () => {
        const { writer, ai, usage } = await build()
        const spent = { promptTokens: 300, completionTokens: 4000, totalTokens: 4300, costUsd: null }
        const served = { upstream: "anthropic", finishReason: "max_tokens", durationMs: 5 }
        ai.attempt.mockResolvedValue({
            ok: false,
            failure: "length",
            spent: { model: "claude-haiku-5-5", usage: spent, served, cap: null },
        })

        await expect(writer.write(brief, KEY)).rejects.toMatchObject({ code: PublicDocumentsErrorCode.DraftRefused })

        expect(usage.record).toHaveBeenCalledTimes(1)
        expect(usage.record).toHaveBeenCalledWith(
            expect.objectContaining({ model: "claude-haiku-5-5", usage: spent, completionChars: 0 }),
        )
    })
})
