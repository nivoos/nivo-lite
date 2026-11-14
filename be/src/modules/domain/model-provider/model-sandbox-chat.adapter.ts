import type { BaseLanguageModelInput } from "@langchain/core/language_models/base"
import {
    BaseChatModel,
    type BaseChatModelCallOptions,
    type BindToolsInput,
} from "@langchain/core/language_models/chat_models"
import type { AIMessage, AIMessageChunk, BaseMessage } from "@langchain/core/messages"
import type { ChatResult } from "@langchain/core/outputs"
import type { Runnable } from "@langchain/core/runnables"
import type { AiChatModel } from "./model-provider.contracts"

/** What one try of a sandbox agent turn came to: the sandbox's own message, or the try passes to the endpoint's client. */
export type SandboxTurnDecision = { readonly message: AIMessage } | { readonly passed: true }

/** The two things the sandbox chat of one try asks of its runner. */
export interface SandboxChatTurn {
    /**
     * Decides the try's case through the sandbox frame (logged on the account under the call's purpose): the sandbox's message, the pass,
     * or the live client's failure THROWN (a deadline, a 5xx).
     */
    decide(): Promise<SandboxTurnDecision>
    /** The endpoint's own client of this try, for the pass-through case (built only when the case passes). */
    endpoint(): Promise<AiChatModel>
}

/**
 * The CHAT CLIENT of one try of an agent turn on a sandbox model account: what the agent loop binds its tools to and invokes, exactly as
 * it does the endpoint's client (LangChain `BaseChatModel`). Its case is decided when it is INVOKED (once per try, through the frame, so
 * the account's call log holds one call per try), never when it is built: the client the loop builds its agent over is never asked and
 * logs nothing. The pass-through case binds the same tools to the endpoint's client and invokes it with the same messages.
 */
export class ModelSandboxChat extends BaseChatModel {
    /** The tools bound to this client, in binding order. */
    private bound: ReadonlyArray<BindToolsInput> = []

    /** The call options the tools were bound with (the tool choice, parallel calls). */
    private boundWith: Partial<BaseChatModelCallOptions> | undefined = undefined

    constructor(private readonly turn: SandboxChatTurn) {
        super({})
    }

    /** The client's kind, as LangChain names it. */
    _llmType(): string {
        return "nivo-sandbox"
    }

    /** A client with the tools bound (the same turn behind it), as the endpoint's client answers `bindTools`. */
    override bindTools(
        tools: Array<BindToolsInput>,
        kwargs?: Partial<BaseChatModelCallOptions>,
    ): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
        const next = new ModelSandboxChat(this.turn)
        next.bound = [...this.bound, ...tools]
        next.boundWith = kwargs
        return next.withConfig({})
    }

    /** One try: the case decided now; the sandbox's message, or the endpoint's answer to the same messages. */
    async _generate(messages: Array<BaseMessage>, options: this["ParsedCallOptions"]): Promise<ChatResult> {
        const decided = await this.turn.decide()
        const message = "message" in decided ? decided.message : await this.passed(messages, options.signal)
        return { generations: [{ text: typeof message.content === "string" ? message.content : "", message }] }
    }

    /** The endpoint's own answer to the try: its client with the same tools bound, the same messages, the same abort signal. */
    private async passed(messages: Array<BaseMessage>, signal: AbortSignal | undefined): Promise<BaseMessage> {
        const live = await this.turn.endpoint()
        const runnable = this.bound.length === 0 || live.bindTools === undefined ? live : live.bindTools([...this.bound], this.boundWith)
        return await runnable.invoke(messages, signal === undefined ? {} : { signal })
    }
}
