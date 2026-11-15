import { parseJsonText } from "@modules/platform/primitives"
import type { AgentTagPayload, AgentTagRequest } from "./agent-tag.contracts"
import type { AgentWakeContext } from "./agent-work.contracts"

/** The most characters of the tagger's words a wake keeps. */
export const TAG_TEXT_MAX = 2000

/** The most characters of a source name or a subject a wake keeps. */
const TAG_LABEL_MAX = 200

/** The language of a tag that names none. */
const DEFAULT_TAG_LOCALE = "vi"

/** The plain data a tag wake carries, or an empty object when it carries none or the stored text does not parse. */
export const tagPayloadOf = (context: AgentWakeContext): AgentTagPayload => {
    if (context.tagContext === undefined) return {}
    const read = parseJsonText(context.tagContext)
    if (!read.ok) return {}
    const parsed = read.value
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? Object.fromEntries(Object.entries(parsed))
        : {}
}

/** The context a tag wake carries: the trigger fields (text, subject, conversation) and who or what tagged. */
export const tagContextOf = (request: AgentTagRequest, payload?: string): AgentWakeContext => ({
    text: request.text.slice(0, TAG_TEXT_MAX),
    ...(payload === undefined ? {} : { tagContext: payload }),
    ...(request.subject == null ? {} : { subject: request.subject.slice(0, TAG_LABEL_MAX) }),
    ...(request.conversationId == null ? {} : { conversationId: request.conversationId }),
    ...(request.channel == null ? {} : { channel: request.channel.slice(0, TAG_LABEL_MAX) }),
    ...(request.leadId == null ? {} : { leadId: request.leadId }),
    locale: request.locale ?? DEFAULT_TAG_LOCALE,
    ...("fromAgentId" in request ? { authorAgentId: request.fromAgentId } : {}),
    ...("source" in request ? { tagSource: request.source.slice(0, TAG_LABEL_MAX) } : {}),
})

/** What a wake says of the workflow call that made it (`core.call-workflow`): the calling run and the params it passed. */
export interface WorkflowCallFacts {
    /** The calling run. */
    readonly callerRunId: string
    /** The params the caller mapped, as plain data. */
    readonly params: Readonly<Record<string, unknown>>
}

const isPlainRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** The call a tag's plain data names (`caller.runId` and `params`, as `core.call-workflow` writes them), or null for a wake no call made. */
export const callOf = (payload: unknown): WorkflowCallFacts | null => {
    if (!isPlainRecord(payload) || !isPlainRecord(payload.caller)) return null
    const runId = payload.caller.runId
    if (typeof runId !== "string" || runId === "") return null
    return { callerRunId: runId, params: isPlainRecord(payload.params) ? payload.params : {} }
}

/**
 * THE ONE READER of the run that called a run, from the plain data of the run's wake (its stored context), or null for a run no call
 * made: the waits ask a child before its parent, and a called run acts in its caller's world (lane concept provider-sandbox rule 19).
 */
export const callerRunIdOf = (context: { readonly tagContext?: unknown }): string | null => {
    const text = context.tagContext
    return typeof text === "string" ? (callOf(tagPayloadOf({ tagContext: text }))?.callerRunId ?? null) : null
}
