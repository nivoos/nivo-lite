import { Injectable } from "@nestjs/common"
import { NEXT_CASE_STATE, ProviderSandboxService, type SandboxState } from "@modules/domain/provider-sandbox"
import type { BindToolsInput } from "@langchain/core/language_models/chat_models"
import type { AIMessage } from "@langchain/core/messages"
import {
    MODEL_PROVIDER,
    type AiChatRequest,
    type AiRunner,
    type AiTurnRequest,
    type ChainReply,
    type ModelAccount,
    type ModelProviderPort,
} from "./model-provider.contracts"
import { MODEL_CALL_OPERATION, MODEL_SANDBOX_CASE, modelCaseOf, type ModelSandboxCaseId } from "./model-sandbox.catalogue"
import { ModelSandboxChat, type SandboxTurnDecision } from "./model-sandbox-chat.adapter"
import { chatReplyOf, turnMessageOfCase } from "./model-sandbox-replies.policy"

/** What a chat call of the sandbox came to, as the call log keeps it: the case, and the sandbox's own reply unless the call passed. */
type ChatDecision =
    | { readonly case: ModelSandboxCaseId; readonly passed: true }
    | { readonly case: ModelSandboxCaseId; readonly reply: ChainReply }

/** What one try of an agent turn came to, as the call log keeps it: the case, and whether the try passed to the endpoint. */
interface TurnLogged {
    readonly case: ModelSandboxCaseId
    readonly passed: boolean
}

/** The kept next case, when it is a case id of the catalogue. */
const keptCaseOf = (value: unknown): ModelSandboxCaseId | null => (typeof value === "string" ? modelCaseOf(value) : null)

/**
 * The case of one call (sticky, rule 12): the case picked for the call's own purpose (the frame's `nextCase` of the operation the call
 * is logged under), else the case picked for every call of the workspace (`call`), else `MODEL-1` (the pass to the endpoint).
 */
const caseOf = async (state: SandboxState): Promise<ModelSandboxCaseId> =>
    keptCaseOf(state.nextCase) ?? keptCaseOf(await state.read(NEXT_CASE_STATE, MODEL_CALL_OPERATION)) ?? MODEL_SANDBOX_CASE.passed

/** What the call log keeps of a chat call: its shape and size, never the prompt (it may carry a customer's words). */
const chatLogOf = (request: AiChatRequest): Readonly<Record<string, unknown>> => ({
    kind: "chat",
    json: request.json,
    structured: request.outputSchema !== undefined || request.schema !== null,
    messages: request.messages.length,
    chars: request.messages.reduce((sum, message) => sum + message.content.length, 0),
    timeoutMs: request.timeoutMs,
})

/** What the call log keeps of one try of an agent turn: the try's client as it was asked for. */
const turnLogOf = (request: AiTurnRequest): Readonly<Record<string, unknown>> => ({
    kind: "turn",
    timeoutMs: request.timeoutMs,
    fallback: request.fallback === true,
    target: request.target?.name ?? null,
})

@Injectable()
/**
 * THE MODEL PROVIDER'S SANDBOX (lane concept provider-sandbox, the model row; R87 lever b): the runner of a sandbox model account. It
 * plays the provider at the endpoint's own wire (`AiRunner`: the raw reply of a chat call, the chat client of one try of an agent turn),
 * so NIVO's model door reads every case exactly as it reads the live endpoint: the tries, the pauses, the stop and every caller's own
 * reading run unchanged. Each call is answered through the ONE frame (`ProviderSandboxService.call`), logged under the call's PURPOSE
 * with the case it got; the case is the account's next case for that purpose, else for every call (`call`), else `MODEL-1`, which passes
 * the call to the endpoint unchanged (the default: a sandbox model account changes nothing until a case is picked). Its own answers report
 * zero usage under the model `nivo-sandbox`: a sandbox call spends no credit and its meter row never passes for a real model. Embeddings
 * are not a model call of this provider's cases: they go to the endpoint. No client of its own, no outside call: the endpoint is handed in.
 */
export class ModelSandboxRunnerService implements ModelProviderPort {
    /** The model provider. */
    readonly provider = MODEL_PROVIDER

    constructor(private readonly sandbox: ProviderSandboxService) {}

    /** The runner of one call of a sandbox model account made for `purpose`. */
    runnerOf(account: ModelAccount, purpose: string, endpoint: AiRunner): AiRunner {
        return {
            chat: (request) => this.chat(account, purpose, request, endpoint),
            turnModel: (request) =>
                Promise.resolve(
                    new ModelSandboxChat({
                        decide: (tools) => this.decideTurn(account, purpose, request, tools),
                        endpoint: () => endpoint.turnModel(request),
                    }),
                ),
            embed: (request) => endpoint.embed(request),
        }
    }

    /** One chat call: its case through the frame; the sandbox's raw reply, the endpoint's (MODEL-1), or the live failure thrown. */
    private async chat(account: ModelAccount, purpose: string, request: AiChatRequest, endpoint: AiRunner): Promise<ChainReply> {
        const decided = await this.sandbox.call<ChatDecision>(account, purpose, chatLogOf(request), {
            key: purpose,
            answer: async (state) => {
                const id = await caseOf(state)
                const reply = chatReplyOf(id, request)
                return reply === null ? { case: id, passed: true } : { case: id, reply }
            },
        })
        return "reply" in decided ? decided.reply : await endpoint.chat(request)
    }

    /** One try of an agent turn, decided when the try's client is invoked: the sandbox's message, the pass, or the live failure thrown. */
    private async decideTurn(account: ModelAccount, purpose: string, request: AiTurnRequest, tools: ReadonlyArray<BindToolsInput>): Promise<SandboxTurnDecision> {
        const made: { message: AIMessage | null } = { message: null }
        await this.sandbox.call<TurnLogged>(account, purpose, turnLogOf(request), {
            key: purpose,
            answer: async (state) => {
                const id = await caseOf(state)
                made.message = turnMessageOfCase(id, state.seq, tools)
                return { case: id, passed: made.message === null }
            },
        })
        return made.message === null ? { passed: true } : { message: made.message }
    }
}
