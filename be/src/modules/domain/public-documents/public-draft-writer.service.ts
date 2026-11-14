import { Injectable } from "@nestjs/common"
import { UsageMeterService } from "@modules/domain/knowledge"
import { InjectAi, spendOf, type AiFailure, type AiService } from "@modules/integrations/ai"
import { InjectEffects, type EffectResult, type Effects } from "@modules/platform/effects"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { parseJsonText } from "@modules/platform/primitives"
import { DRAFT_MODEL_EFFECT } from "@modules/queues/knowledge"
import { DRAFT_SYSTEM_PROMPT, PUBLIC_DRAFT_PROMPT_VERSION, draftPrompt } from "./draft-prompt.policy"
import { DRAFT_OUTPUT_SCHEMA } from "./draft-answer.policy"
import { DRAFT_READ_SCHEMA, type DraftAnswer } from "./draft.schema"
import { PublicDocumentsError, PublicDocumentsErrorCode } from "./errors/public-documents.error"
import type { PublicDraftBrief } from "./public-documents.contracts"
import { PublicDocumentsLogEvent } from "./public-documents.log-events"

/** How long the model may take to read the documents and write one text. */
const DRAFT_TIMEOUT_MS = 90_000

/** What of a draft answer the ledger keeps: the verdict and the text (at most `MAX_BODY_CHARS`), so a run again answers from it and never asks twice. */
const keptOf = (answer: DraftAnswer): EffectResult => ({ answers: answer.answers, body: answer.body })

/** The draft answer a kept result stands for (the inverse of `keptOf`); a stored shape that does not fit is a refusal. */
const answerOf = (kept: EffectResult): DraftAnswer => {
    const parsed = DRAFT_READ_SCHEMA.safeParse(kept)
    if (!parsed.success) throw new PublicDocumentsError({ code: PublicDocumentsErrorCode.DraftRefused })
    return parsed.data
}

/** The fence a model may wrap its JSON in. */
const FENCE = /`{3}(?:json)?/giu

/** The first JSON object found in a text a model wrapped in prose or a fence, or null. */
const objectIn = (text: string): unknown => {
    const body = text.replaceAll(FENCE, "")
    const from = body.indexOf("{")
    const to = body.lastIndexOf("}")
    if (from < 0 || to <= from) return null
    const read = parseJsonText(body.slice(from, to + 1))
    return read.ok ? read.value : null
}

@Injectable()
/**
 * Asks the model, in ONE call, to write the text for customers from public-area documents, and whether the documents answer what is
 * asked at all. JSON mode with the API's structured output where the route has it, usage recorded under the kind `brain` and the
 * module `public_documents`. The call is an outside effect keyed by the job (`<jobId>:draft`) whose answer is KEPT: a run again after a
 * crash answers from the ledger and never asks, or bills, twice. What it comes to is never a value to branch on: an answer is returned, a model that did not answer in time throws
 * the transient `DraftUnavailable` (the job's ladder decides), a model that wrote nothing or an answer that does not fit throws the
 * refusal `DraftRefused` (a dead letter with one item: the same prompt gets the same answer), no endpoint throws `DraftUnconfigured`.
 */
export class PublicDraftWriterService {
    constructor(
        @InjectAi() private readonly ai: AiService,
        private readonly usage: UsageMeterService,
        @InjectLogger() private readonly logger: Logger,
        @InjectEffects() private readonly effects: Effects,
    ) {}

    /** The model's answer, or a typed failure (nothing of the sources is then written anywhere). `key` is the effect key `<jobId>:draft`. */
    write(brief: PublicDraftBrief, key: string): Promise<DraftAnswer> {
        return this.effects.once(key, DRAFT_MODEL_EFFECT, { act: () => this.ask(brief), keep: keptOf, from: answerOf })
    }

    /** One call. A try that returned tokens is booked with what it spent, a cut one included. */
    private async ask(brief: PublicDraftBrief): Promise<DraftAnswer> {
        const user = draftPrompt(brief)
        const tried = await this.ai.attempt({
            messages: [
                { role: "system", content: DRAFT_SYSTEM_PROMPT },
                { role: "user", content: user },
            ],
            json: true,
            schema: DRAFT_READ_SCHEMA,
            outputSchema: DRAFT_OUTPUT_SCHEMA,
            timeoutMs: DRAFT_TIMEOUT_MS,
            context: null,
        })
        const spend = spendOf(tried)
        if (spend !== null) {
            await this.usage.record({
                workspaceId: brief.workspaceId,
                kind: "brain",
                module: "public_documents",
                promptChars: DRAFT_SYSTEM_PROMPT.length + user.length,
                tryNumber: 1,
                ...spend,
            })
        }
        if (!tried.ok) throw this.failureOf(tried.failure)
        const answer = tried.answer
        const structured = DRAFT_READ_SCHEMA.safeParse(answer.parsed)
        const parsed = structured.success ? structured : DRAFT_READ_SCHEMA.safeParse(objectIn(answer.text))
        if (parsed.success) {
            this.logger.info(PublicDocumentsLogEvent.DraftRead, {
                promptVersion: PUBLIC_DRAFT_PROMPT_VERSION,
                answers: parsed.data.answers,
                bodyChars: parsed.data.body.length,
            })
            return parsed.data
        }
        this.logger.warn(PublicDocumentsLogEvent.AnswerUnreadable, { promptVersion: PUBLIC_DRAFT_PROMPT_VERSION })
        throw new PublicDocumentsError({ code: PublicDocumentsErrorCode.DraftRefused })
    }

    /** What a call that gave no answer is: an outage heals (transient), a missing endpoint is a setting, nothing written or cut is a refusal. */
    private failureOf(failure: AiFailure): PublicDocumentsError {
        if (failure === "timeout" || failure === "provider") return new PublicDocumentsError({ code: PublicDocumentsErrorCode.DraftUnavailable })
        if (failure === "unconfigured") return new PublicDocumentsError({ code: PublicDocumentsErrorCode.DraftUnconfigured })
        return new PublicDocumentsError({ code: PublicDocumentsErrorCode.DraftRefused })
    }
}
