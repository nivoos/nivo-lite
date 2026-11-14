import { AIMessage } from "@langchain/core/messages"
import type { ChainReply } from "./model-provider.contracts"
import { MODEL_SANDBOX_CASE, MODEL_SANDBOX_MODEL, MODEL_SANDBOX_UPSTREAM, type ModelSandboxCaseId } from "./model-sandbox.catalogue"
import { ModelSandboxProviderError, ModelSandboxTimeoutError } from "./errors/model-sandbox-faults"

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
const chainReplyOf = (content: string, finish: string): ChainReply => ({
    content,
    parsed: null,
    usageMetadata: NO_USAGE,
    responseMetadata: metadataOf(finish),
    retrieved: 0,
    provider: MODEL_SANDBOX_UPSTREAM,
})

/** What a case does to a call: throws the live client's failure, or answers in the provider's raw shape; null for the pass-through case. */
const thrownOf = (id: ModelSandboxCaseId): Error | null => {
    if (id === MODEL_SANDBOX_CASE.timedOut) return new ModelSandboxTimeoutError()
    if (id === MODEL_SANDBOX_CASE.providerError) return new ModelSandboxProviderError()
    return null
}

/**
 * The raw reply of a chat call (`AiRunner.chat`) under a case, or null for `MODEL-1` (the call passes to the endpoint). Throws the live
 * client's failure for `MODEL-4` / `MODEL-5`.
 */
export const chatReplyOf = (id: ModelSandboxCaseId): ChainReply | null => {
    const thrown = thrownOf(id)
    if (thrown !== null) throw thrown
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

/**
 * The message of one try of an agent turn (the chat client of the try invoked) under a case, or null for `MODEL-1` (the try passes to
 * the endpoint's client). Throws the live client's failure for `MODEL-4` / `MODEL-5`. `seq` is the running number of the purpose's calls
 * (a deterministic tool call id).
 */
export const turnMessageOfCase = (id: ModelSandboxCaseId, seq: number): AIMessage | null => {
    const thrown = thrownOf(id)
    if (thrown !== null) throw thrown
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
