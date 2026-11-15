import type { BindToolsInput } from "@langchain/core/language_models/chat_models"
import { AIMessage } from "@langchain/core/messages"
import { z } from "zod"
import type { AiChatRequest, ChainReply } from "./model-provider.contracts"
import { MODEL_SANDBOX_CASE, MODEL_SANDBOX_MODEL, MODEL_SANDBOX_UPSTREAM, type ModelSandboxCaseId } from "./model-sandbox.catalogue"
import { ModelSandboxContextError, ModelSandboxProviderError, ModelSandboxRateLimitError, ModelSandboxTimeoutError } from "./errors/model-sandbox-faults"
import { instanceOfSchema } from "./model-sandbox-instance.policy"

/** The words of the fixed answer when no structure is asked (a free-text chat call). */
export const MODEL_SANDBOX_ANSWER_TEXT = "NIVO Sandbox: a fixed answer, no model was asked."

/** The name of the agent loop's own "done" tool (`integrations/langgraph/agent-loop/loop-frame.policy.ts` `DONE_TOOL`). */
export const MODEL_SANDBOX_DONE_TOOL = "done"

/** The words of the malformed case: prose where a JSON object or a structured line is asked. */
export const MODEL_SANDBOX_MALFORMED_TEXT = "NIVO Sandbox: here is my answer in plain words, not in the format you asked for."

/** The words of the cut case: half a JSON object, as a reply cut at the token limit leaves it. */
export const MODEL_SANDBOX_CUT_TEXT = '{"answer": {"reply": "NIVO Sandbox: this answer was cut at the'

/** The confusion of the "cannot" case, in the node protocol's own fields (agent-sdk `NodeConfusion`). */
export const MODEL_SANDBOX_CONFUSION = {
    reason: "NIVO Sandbox: I cannot decide this from what I was given.",
    question: null,
} as const

/** The name of the agent loop's own "cannot" tool (`integrations/langgraph/agent-loop/loop-frame.policy.ts` `CONFUSED_TOOL`). */
export const MODEL_SANDBOX_CONFUSED_TOOL = "confused"

/** What a sandbox answer used: nothing (a sandbox call spends no credit; the meter books zero under the sandbox's model name). */
const NO_USAGE = { input_tokens: 0, output_tokens: 0, total_tokens: 0 } as const

/** The response metadata of a sandbox answer: the sandbox's model name, why it stopped, and a cost of zero. */
const metadataOf = (finish: string): { model_name: string; finish_reason: string; usage: { cost: number } } => ({
    model_name: MODEL_SANDBOX_MODEL,
    finish_reason: finish,
    usage: { cost: 0 },
})

/** A sandbox reply of a chat call in the endpoint's raw shape (`ChainReply`), read by the model door as a live reply is. */
const chainReplyOf = (content: string, finish: string, parsed: unknown = null): ChainReply => ({
    content,
    parsed,
    usageMetadata: NO_USAGE,
    responseMetadata: metadataOf(finish),
    retrieved: 0,
    provider: MODEL_SANDBOX_UPSTREAM,
})

/** What a case does to a call: throws the live client's failure, or answers in the provider's raw shape; null for the pass-through case. */
const thrownOf = (id: ModelSandboxCaseId): Error | null => {
    if (id === MODEL_SANDBOX_CASE.timedOut) return new ModelSandboxTimeoutError()
    if (id === MODEL_SANDBOX_CASE.providerError) return new ModelSandboxProviderError()
    if (id === MODEL_SANDBOX_CASE.rateLimited) return new ModelSandboxRateLimitError()
    if (id === MODEL_SANDBOX_CASE.tooLong) return new ModelSandboxContextError()
    return null
}

/** A value as a record, or null. */
const recordOf = (value: unknown): Readonly<Record<string, unknown>> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : null

/**
 * The fixed answer of a chat call in the shape it asked: the smallest value of its JSON Schema (`outputSchema`), else of its zod schema
 * (turned into a JSON Schema, the value checked against the zod schema itself: a value that does not fit is parsed as null, as a live
 * answer that did not fit), else `{}` for any JSON object, else the fixed words. Structure only: nothing is read from the prompt.
 */
const answerOf = (request: AiChatRequest): { readonly text: string; readonly parsed: Readonly<Record<string, unknown>> | null } => {
    if (request.outputSchema !== undefined) {
        const value = instanceOfSchema(request.outputSchema)
        return { text: JSON.stringify(value), parsed: recordOf(value) }
    }
    if (request.schema !== null) {
        const asked = request.schema
        const made = ((): unknown => {
            try {
                return instanceOfSchema(z.toJSONSchema(asked))
            } catch {
                return {}
            }
        })()
        const checked = asked.safeParse(made)
        return { text: JSON.stringify(made), parsed: checked.success ? recordOf(checked.data) : null }
    }
    if (request.json) return { text: "{}", parsed: {} }
    return { text: MODEL_SANDBOX_ANSWER_TEXT, parsed: null }
}

/**
 * The raw reply of a chat call (`AiRunner.chat`) under a case, or null for `MODEL-1` (the call passes to the endpoint). Throws the live
 * client's failure for `MODEL-4` / `MODEL-5` / `MODEL-10` / `MODEL-11`. A chat call offers no tools, so `MODEL-9` answers it as `MODEL-8`.
 */
export const chatReplyOf = (id: ModelSandboxCaseId, request: AiChatRequest): ChainReply | null => {
    const thrown = thrownOf(id)
    if (thrown !== null) throw thrown
    if (id === MODEL_SANDBOX_CASE.answered || id === MODEL_SANDBOX_CASE.toolCall) {
        const answer = answerOf(request)
        return chainReplyOf(answer.text, "stop", answer.parsed)
    }
    if (id === MODEL_SANDBOX_CASE.refused) return chainReplyOf("", "refusal")
    if (id === MODEL_SANDBOX_CASE.malformed) return chainReplyOf(MODEL_SANDBOX_MALFORMED_TEXT, "stop")
    if (id === MODEL_SANDBOX_CASE.cut) return chainReplyOf(MODEL_SANDBOX_CUT_TEXT, "length")
    if (id === MODEL_SANDBOX_CASE.confused) return chainReplyOf(JSON.stringify({ confused: MODEL_SANDBOX_CONFUSION }), "stop")
    return null
}

/** A sandbox message of one agent turn, read by the model door as a live turn is (`AiService.readTurn`). */
const turnMessageOf = (content: string, finish: string, toolCalls: NonNullable<AIMessage["tool_calls"]> = []): AIMessage =>
    new AIMessage({
        content,
        tool_calls: toolCalls,
        // The message type of this LangChain version takes no `usage_metadata` here: the zero usage rides in `tokenUsage`, which the
        // model door's usage reading falls back to.
        response_metadata: { ...metadataOf(finish), tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
        additional_kwargs: { __raw_response: { provider: MODEL_SANDBOX_UPSTREAM } },
    })

/** One tool the request offered, as its name and the JSON Schema of its arguments (an OpenAI-style function definition or a LangChain tool). */
interface OfferedTool {
    readonly name: string
    readonly schema: unknown
}

/** The tool a bound entry is, or null for an entry of a shape this reading does not know. */
const offeredOf = (tool: BindToolsInput): OfferedTool | null => {
    const entry = recordOf(tool)
    if (entry === null) return null
    const wire = recordOf(entry.function)
    if (wire !== null && typeof wire.name === "string") return { name: wire.name, schema: wire.parameters }
    if (typeof entry.name !== "string") return null
    const own = entry.schema
    const asJson = (): unknown => {
        try {
            return own instanceof z.ZodType ? z.toJSONSchema(own) : own
        } catch {
            return {}
        }
    }
    return { name: entry.name, schema: asJson() }
}

/** The fixed tool call of an agent turn: the FIRST tool offered with the smallest arguments its schema allows, or none when none was offered. */
const toolCallOf = (tools: ReadonlyArray<BindToolsInput>, seq: number): NonNullable<AIMessage["tool_calls"]> => {
    const first = tools.map(offeredOf).find((one) => one !== null)
    if (first === undefined || first === null) return []
    const args = recordOf(instanceOfSchema(first.schema)) ?? {}
    return [{ type: "tool_call", id: `sbx-tool-${String(seq + 1)}`, name: first.name, args }]
}

/**
 * The message of one try of an agent turn (the chat client of the try invoked) under a case, or null for `MODEL-1` (the try passes to
 * the endpoint's client). Throws the live client's failure for `MODEL-4` / `MODEL-5` / `MODEL-10` / `MODEL-11`. `seq` is the running
 * number of the purpose's calls (a deterministic tool call id); `tools` are the tools bound to the try's client, in binding order.
 * `MODEL-9` calls the first of them; `MODEL-8` calls the loop's `done` with the output the `done` tool's own schema allows (the step's
 * output schema is not on the model's wire), or answers the fixed words when no `done` is offered.
 */
export const turnMessageOfCase = (id: ModelSandboxCaseId, seq: number, tools: ReadonlyArray<BindToolsInput> = []): AIMessage | null => {
    const thrown = thrownOf(id)
    if (thrown !== null) throw thrown
    if (id === MODEL_SANDBOX_CASE.toolCall) {
        const calls = toolCallOf(tools, seq)
        return turnMessageOf(calls.length === 0 ? MODEL_SANDBOX_ANSWER_TEXT : "", calls.length === 0 ? "stop" : "tool_calls", calls)
    }
    if (id === MODEL_SANDBOX_CASE.answered) {
        const done = tools.map(offeredOf).find((one) => one?.name === MODEL_SANDBOX_DONE_TOOL)
        if (done === undefined || done === null) return turnMessageOf(MODEL_SANDBOX_ANSWER_TEXT, "stop")
        const args = recordOf(instanceOfSchema(done.schema)) ?? {}
        return turnMessageOf("", "tool_calls", [{ type: "tool_call", id: `sbx-done-${String(seq + 1)}`, name: MODEL_SANDBOX_DONE_TOOL, args }])
    }
    if (id === MODEL_SANDBOX_CASE.refused) return turnMessageOf("", "refusal")
    if (id === MODEL_SANDBOX_CASE.malformed) return turnMessageOf(MODEL_SANDBOX_MALFORMED_TEXT, "stop")
    if (id === MODEL_SANDBOX_CASE.cut) return turnMessageOf("", "length")
    if (id === MODEL_SANDBOX_CASE.confused) {
        return turnMessageOf("", "tool_calls", [
            {
                type: "tool_call",
                id: `sbx-confused-${String(seq + 1)}`,
                name: MODEL_SANDBOX_CONFUSED_TOOL,
                args: { ...MODEL_SANDBOX_CONFUSION },
            },
        ])
    }
    return null
}
