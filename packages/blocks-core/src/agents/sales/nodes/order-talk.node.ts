import { PROVIDER, TOOL } from "@nivo-lite/agent-sdk/names"
import { defineTemplateNode, type TemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { MAX_BODY, MAX_ID, MAX_LINE } from "../../../shared/bounds"
import { bilingualOf, messageOf } from "../../../shared/messages/catalog"
import { threadLine, threadRead } from "../../../shared/customer-chat/front-desk.fixtures"
import { threadRowsOf, unreadPicturesOf, unreadTextOf } from "../../../shared/customer-chat/front-desk.reads"
import type { NodeLocale, NodeSchema } from "../../../shared/nodes/node-schema.types"
import { SENT_VIA_ZALO } from "./care.examples"
import { CARE_VOICE, refusalSchema, sendToContact } from "./care.steps"

/** The customer's message while the order waits for its money, and the order it may be about. */
export interface OrderTalkInput {
    /** The customer. */
    readonly contactId: string | null
    /**
     * The line that woke the step (the event the sale's payment wait took). What the step judges and answers is every line the customer
     * wrote since the shop last spoke, read from the thread; this line stands only when the thread holds no unread words.
     */
    readonly text: string
    /** The order's code. */
    readonly orderNo: string
    /** The order's total, VND. */
    readonly amountVnd: number | null
    /** The language the shop writes in. */
    readonly locale: NodeLocale
}

/**
 * Where the message goes: answered here (`about`); a wish to cancel this order (`cancel`: nothing is said here, the sale's cancel steps
 * carry it out and tell the customer how it ended); or not about the order (`off`: the sale gives it back).
 */
export type OrderTalkTopic = "about" | "cancel" | "off"

/** The topics, in the order the step declares its routes. */
export const ORDER_TALK_TOPICS: readonly ["about", "cancel", "off"] = ["about", "cancel", "off"]

/** What the step came to. */
export interface OrderTalkOutput {
    /** `about`: about the order, answered; `cancel`: the customer asks to cancel this order, nothing was said; `off`: something else, nothing was said. */
    readonly topic: OrderTalkTopic
    /** True when the answer reached the customer. */
    readonly sent: boolean
    /** The send's refusal when it did not, else null. */
    readonly refusal: string | null
    /** With `cancel`: why, in a few words (what the customer said), or null; null otherwise. */
    readonly cancelReason: string | null
}

const input: NodeSchema<OrderTalkInput> = z.object({
    contactId: z.string().min(1).max(MAX_ID).nullable(),
    text: z.string().max(MAX_BODY),
    orderNo: z.string().min(1).max(MAX_ID),
    amountVnd: z.number().int().min(0).nullable(),
    locale: z.enum(["vi", "en"]),
})

const output: NodeSchema<OrderTalkOutput> = z.object({
    topic: z
        .enum(ORDER_TALK_TOPICS)
        .describe("about: the message is about this order and was answered; cancel: the customer asks to cancel this order (nothing was said); off: it is about something else"),
    sent: z.boolean().describe("True when the answer reached the customer."),
    refusal: refusalSchema,
    cancelReason: z.string().min(1).max(MAX_LINE).nullable().describe("With cancel: why, in a few words; otherwise null."),
})

/** The most pictures of the customer one decision is shown. */
const PICTURES_SHOWN_MAX = 4

/**
 * What the model decides: what the message is (a question or remark about the order, a wish to cancel it, or something else), and the
 * answer when it is about the order. MEANING is the model's, never a word list. A wish to cancel is an OUTCOME the sale acts on (the shop
 * decides, the customer is told how it ended), so it is never answered in words here: words would promise what no step does.
 */
const decision = z.object({
    topic: z
        .enum(ORDER_TALK_TOPICS)
        .describe(
            "about: the message is about this order (its items, total, payment or delivery) and you answer it; cancel: the customer asks to cancel this order " +
                "(you write no reply: the steps after you cancel it once the shop agrees and tell the customer how it ended); off: anything else",
        ),
    reply: z.string().max(MAX_BODY).nullable().describe("The one short answer to the customer when topic is about, from the order facts given; null when cancel or off"),
    cancelReason: z
        .string()
        .min(1)
        .max(MAX_LINE)
        .nullable()
        .describe("With cancel: why, in a few words of what the customer said, or null when they gave none; null otherwise"),
})

const GUIDANCE = [
    "Answer only from the order facts given (`orderNo`, `amountVnd`): never invent a price, a date or a promise, and never confirm a payment: the bank's credit confirms it.",
    "Your reply only answers: it never says that a request was recorded, passed on or will be handled by the shop. A wish to cancel this order is the topic `cancel` with no reply; another matter is `off`.",
    CARE_VOICE,
].join("\n")

const ABOUT = "Your order DH-20261113-0001 is 4,500 VND; please put DH-20261113-0001 as the transfer content."

/** The shop's last line of the examples' thread: the order it told (what the customer then writes about). */
const ORDER_TOLD = threadLine("agent", "Order DH-20261113-0001: 4,500 VND, scan the QR to pay.", "2026-11-13T09:00:00.000Z")

/**
 * `sales.order-talk` (Trao doi ve don): the customer wrote while their order waits for its money. The step reads what the customer wrote
 * since the shop last spoke from the engine's thread (every line and picture, not only the one that woke it); the model reads it against the
 * order and decides by MEANING whether it is about the order (`context.agent.run`, no word list); when it is, it writes one short answer
 * and the step sends it to the customer; when the customer asks to cancel the order, nothing is said (`cancel`: the sale's cancel steps
 * ask the shop, cancel it and tell the customer how it ended; words here would promise what no step does); when it is about something
 * else, nothing is said and the sale gives the message back (`handBack`) so the next waiter, else the front desk, takes it. Routed by `topic`.
 */
export const salesOrderTalkNode: TemplateNode<typeof input, typeof output, NodeSchema<Record<string, never>>, OrderTalkTopic> = defineTemplateNode({
    id: "sales.order-talk",
    title: bilingualOf("nodeSalesOrderTalkTitle"),
    description: {
        vi: "Khi đơn đang chờ tiền mà khách nhắn: hiểu tin nhắn có nói về đơn không; có thì trả lời ngắn từ thông tin đơn, không thì trả tin nhắn lại.",
        en: "When the customer writes while the order waits for its money: decides whether the message is about the order; if so answers briefly from the order, else gives it back.",
    },
    tools: [TOOL.conversationMessageList, TOOL.customerMessageSend],
    mode: "auto",
    accounts: [PROVIDER.zaloOa, PROVIDER.telegram, PROVIDER.meta],
    // Reads the person's lines with `consume: true` (the stream cursor): the lines held behind a stopped run are this step's to take (E-FIX12 rule A-7).
    readsHeldEvents: true,
    input,
    output,
    model: "claude-sonnet-5-5",
    routes: { by: "topic", names: ORDER_TALK_TOPICS },
    run: async (given, context) => {
        // What the person said is every line since the shop last spoke (the engine's thread of the run's route, pictures included), not
        // only the line that woke the step: several lines may come in one wake (R73). The woken line stands when the thread holds no words.
        const rows = await threadRowsOf(context, { consume: true })
        const unread = unreadTextOf(rows)
        const decided = await context.agent.run({
            goal: `${messageOf("en", "nodeSalesOrderTalkGoal")}\n${GUIDANCE}`,
            input: { message: unread === "" ? given.text : unread, orderNo: given.orderNo, amountVnd: given.amountVnd, locale: given.locale },
            images: unreadPicturesOf(rows, PICTURES_SHOWN_MAX),
            output: decision,
            tools: [],
            // One answer is the work; the second turn is there only for an answer the loop refused (no turn shape, an output that does not
            // fit): the model reads why and answers again, instead of the sale stopping confused on one slip (MX-CORE DEF-2).
            maxTurns: 2,
        })
        // A wish to cancel is the sale's to carry out: nothing is said here, the cancel steps tell the customer how it ended.
        if (decided.topic === "cancel") return { topic: "cancel", sent: false, refusal: null, cancelReason: decided.cancelReason }
        if (decided.topic === "off" || decided.reply === null || decided.reply.trim() === "") return { topic: "off", sent: false, refusal: null, cancelReason: null }
        if (given.contactId === null) return context.fail({ kind: "cannot", why: "an answer about the order was reached with no customer" })
        const said = await sendToContact(context, given.contactId, decided.reply)
        return { topic: "about", sent: said.sent, refusal: said.refusal, cancelReason: null }
    },
    examples: [
        {
            name: "a question about the order's total is answered from the order and sent",
            params: {},
            input: { contactId: "contact-1", text: "how much was it again?", orderNo: "DH-20261113-0001", amountVnd: 4500, locale: "en" },
            agent: [{ answer: { topic: "about", reply: ABOUT, cancelReason: null } }],
            tools: [
                threadRead([ORDER_TOLD, threadLine("user", "how much was it again?", "2026-11-13T09:05:00.000Z")]),
                { id: TOOL.customerMessageSend, args: { contactId: "contact-1", text: ABOUT }, answer: SENT_VIA_ZALO },
            ],
            output: { topic: "about", sent: true, refusal: null, cancelReason: null },
        },
        {
            name: "several lines since the shop last spoke are read together and answered once, whatever line woke the step",
            params: {},
            input: { contactId: "contact-1", text: "hi", orderNo: "DH-20261113-0001", amountVnd: 4500, locale: "en" },
            agent: [{ answer: { topic: "about", reply: ABOUT, cancelReason: null } }],
            tools: [
                threadRead([
                    ORDER_TOLD,
                    threadLine("user", "hi", "2026-11-13T09:05:00.000Z"),
                    threadLine("user", "how much was it again?", "2026-11-13T09:05:10.000Z"),
                ]),
                { id: TOOL.customerMessageSend, args: { contactId: "contact-1", text: ABOUT }, answer: SENT_VIA_ZALO },
            ],
            output: { topic: "about", sent: true, refusal: null, cancelReason: null },
        },
        {
            name: "a message about something else is not answered here: the sale gives it back",
            params: {},
            input: { contactId: "contact-1", text: "do you also do weddings?", orderNo: "DH-20261113-0001", amountVnd: 4500, locale: "en" },
            agent: [{ answer: { topic: "off", reply: null, cancelReason: null } }],
            tools: [threadRead([ORDER_TOLD, threadLine("user", "do you also do weddings?", "2026-11-13T09:05:00.000Z")])],
            output: { topic: "off", sent: false, refusal: null, cancelReason: null },
        },
        {
            name: "a wish to cancel the order is the outcome `cancel`: nothing is said here, the sale's cancel steps carry it out and tell the customer",
            params: {},
            input: { contactId: "contact-1", text: "please cancel it, I don't need the flowers any more", orderNo: "DH-20261113-0001", amountVnd: 4500, locale: "en" },
            agent: [{ answer: { topic: "cancel", reply: null, cancelReason: "no longer needs the flowers" } }],
            tools: [threadRead([ORDER_TOLD, threadLine("user", "please cancel it, I don't need the flowers any more", "2026-11-13T09:05:00.000Z")])],
            output: { topic: "cancel", sent: false, refusal: null, cancelReason: "no longer needs the flowers" },
        },
    ],
})
