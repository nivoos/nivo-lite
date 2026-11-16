import { PROVIDER, TOOL } from "@nivo-lite/agent-sdk/names"
import { type TemplateNode, defineTemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { MAX_BODY, MAX_ID } from "../../../shared/bounds"
import type { NodeSchema } from "../../../shared/nodes/node-schema.types"
import { sayToCustomer, saidOrCannot } from "../../../shared/customer-chat/say-to-customer"
import { refused } from "../../../shared/nodes/tool-answers"
import { chatSend, threadRead } from "../../../shared/customer-chat/front-desk.fixtures"
import { STOP_REPLY_GOAL } from "../../../shared/customer-chat/front-desk.policy"
import { threadOf } from "../../../shared/customer-chat/front-desk.reads"
import { bilingualOf } from "../../../shared/messages/catalog"

type NoParams = Record<string, never>

/** What the acknowledgement is written from. */
export interface StopReplyInput {
    /** The conversation the person wrote in: the answer goes there, on their own line. */
    readonly conversationId: string
    /** What the customer said, one message per line. */
    readonly text: string
    /** The chat's window on the route's lines (`chatbot.hear`'s `startedAt`): the thread is read from then on; null: the whole route. */
    readonly since?: string | null | undefined
}

/** What the agent writes: the one short acknowledgement. */
interface StopReplyWritten {
    /** The words for the customer. */
    readonly reply: string
}

/** What the step did: the words (sent unless declined) and whether a person declined the send. */
export interface StopReplyOutput extends StopReplyWritten {
    /** True when a person declined the send on its card: nothing was sent. */
    readonly declined: boolean
}

const TEXT_MAX = 8000
const ASKED_VI = "Shop đừng nhắn tin cho mình nữa nhé"
const THANKS_VI =
    "Cảm ơn bạn đã cho shop biết. Shop đã ghi nhận và sẽ không nhắn tin trước cho bạn nữa; khi nào cần bạn cứ nhắn ở đây, shop sẽ trả lời ngay."

const params: NodeSchema<NoParams> = z.strictObject({})
const input: NodeSchema<StopReplyInput> = z.object({
    conversationId: z.string().min(1).max(MAX_ID),
    text: z.string().max(TEXT_MAX),
    since: z.string().max(40).nullish(),
})
const written: NodeSchema<StopReplyWritten> = z.object({
    reply: z.string().min(1).max(MAX_BODY).describe("The one short chat message for the customer; the step sends it"),
})
const output: NodeSchema<StopReplyOutput> = z.object({
    reply: z.string().min(1).max(MAX_BODY).describe("The one short chat message for the customer: sent, unless a person declined it"),
    declined: z.boolean().describe("True when a person declined the send on its card: their decision, nothing sent."),
})

/**
 * `chatbot.stop-reply` (the front desk acknowledges a request to stop): an agent step after `chatbot.stop-keep`. The agent writes ONE
 * short message that thanks the person and says the shop noted it and will not write first; the step sends it on the person's OWN line
 * (the conversation they wrote in: an answer there is always allowed, even to a person who asked not to be contacted). The update and
 * this send are separate steps, so each `ask` step makes one write. A declined send is the step's unsuccessful ending (the engine tells the team).
 */
export const chatbotStopReplyNode: TemplateNode<NodeSchema<StopReplyInput>, NodeSchema<StopReplyOutput>, NodeSchema<NoParams>> =
    defineTemplateNode({
        id: "chatbot.stop-reply",
        title: bilingualOf("nodeChatbotStopReplyTitle"),
        description: { vi: "Nhắn lại trên đúng cuộc trò chuyện một lời cảm ơn ngắn: shop đã ghi nhận và sẽ không nhắn tin trước.", en: "Replies on the same conversation with one short thanks: the shop has noted it and will not write first." },
        tools: [TOOL.conversationMessageList, TOOL.customerMessageSend],
        mode: "auto",
        accounts: [PROVIDER.zaloOa, PROVIDER.telegram, PROVIDER.meta],
        params,
        input,
        output,
        model: "claude-sonnet-5-5",
        run: async (given, context) => {
            const conversation = await threadOf(context, { since: given.since })
            const draft = await context.agent.run({
                goal: STOP_REPLY_GOAL,
                input: { message: given.text, conversation: [...conversation] },
                output: written,
                tools: [],
                maxTurns: 1,
            })
            const said = await sayToCustomer(context, { text: draft.reply }, { chat: { conversationId: given.conversationId } })
            if (!said.ok && said.declined) return { ...draft, declined: true }
            saidOrCannot(context, said)
            return { ...draft, declined: false }
        },
        examples: [
            {
                name: "thanks the person once, on their own conversation, and says nothing more",
                params: {},
                input: { conversationId: "c1", text: ASKED_VI },
                tools: [threadRead([]), ...chatSend(THANKS_VI)],
                agent: [{ answer: { reply: THANKS_VI } }],
                output: { reply: THANKS_VI, declined: false },
            },
            {
                name: "the owner declines the acknowledgement on its card: their decision, nothing is sent and the step returns declined",
                params: {},
                input: { conversationId: "c1", text: ASKED_VI },
                tools: [
                    threadRead([]),
                    { id: TOOL.customerMessageSend, args: { text: THANKS_VI }, answer: refused("declined") },
                ],
                agent: [{ answer: { reply: THANKS_VI } }],
                output: { reply: THANKS_VI, declined: true },
            },
        ],
    })
