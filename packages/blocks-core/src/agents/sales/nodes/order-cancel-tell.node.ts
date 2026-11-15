import { PROVIDER, TOOL } from "@nivo-lite/agent-sdk/names"
import { defineTemplateNode, type TemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { MAX_BODY, MAX_ID } from "../../../shared/bounds"
import { bilingualOf, messageOf } from "../../../shared/messages/catalog"
import { careMessageSchema } from "./care.steps"
import type { NodeLocale, NodeSchema } from "../../../shared/nodes/node-schema.types"
import { sayToCustomer, saidOrCannot } from "../../../shared/customer-chat/say-to-customer"
import { refused, sentAnswer } from "../../../shared/nodes/tool-answers"

/** The order the customer asked to cancel, how that ended, and the conversation to tell the customer in. */
export interface OrderCancelTellInput {
    /** The customer's conversation. */
    readonly conversationId: string
    /** The number of the order; null only when the graph is wired wrongly (a cancel that answered no number). */
    readonly orderNo: string | null
    /** True when the cancel step cancelled the order; false when a person of the shop declined the cancel and the order stays. */
    readonly cancelled: boolean
    /** The language the shop writes in. */
    readonly locale: NodeLocale
}

/** What the customer was told. */
export interface OrderCancelTellOutput {
    /** The words sent; null when a person declined the send. */
    readonly text: string | null
    /** True when a person declined the send on its card: the customer is not told the order is cancelled; the graph routes on it. */
    readonly declined: boolean
}

/** The id of the step. */
const ID = "sales.order-cancel-tell"

const input: NodeSchema<OrderCancelTellInput> = z.object({
    conversationId: z.string().min(1).max(MAX_ID),
    orderNo: z.string().min(1).max(MAX_ID).nullable(),
    cancelled: z.boolean(),
    locale: z.enum(["vi", "en"]),
})

const output: NodeSchema<OrderCancelTellOutput> = z.object({
    text: z.string().min(1).max(MAX_BODY).nullable().describe("The one message sent to the customer; null when the send was declined."),
    declined: z.boolean().describe("True when a person declined the send on its card: the customer was not told."),
})

/** What the agent writes: the one message the step sends. */
const written = careMessageSchema

/** How the agent of the step behaves: the guidance of the goal, never a line it must say; one for each way the cancel ended. */
const GUIDANCE_CANCELLED = [
    "Write ONE short message for the customer, in `locale`, that order `orderNo` is cancelled, and offer to help with anything else. The step sends it.",
    "The order IS cancelled: the step before you cancelled it and the tool answered so. Promise no refund, no new order and no date.",
].join("\n")
const GUIDANCE_KEPT = [
    "Write ONE short message for the customer, in `locale`, that the shop keeps order `orderNo` as it is: a person of the shop decided it stays, so it is not cancelled and still waits for the payment the customer was told. Offer to help with anything else. The step sends it.",
    "Give no reason the facts do not hold; promise no refund, no change of the order and no date.",
].join("\n")

/** The line of the example, as the old consult example sent it. */
const CANCELLED_DH7 = "Order DH-7 is cancelled. Anything else I can help with?"

/** The line of the example where a person of the shop kept the order. */
const KEPT_DH7 = "The shop keeps order DH-7 as it is, so it still waits for your transfer. Anything else I can help with?"

/**
 * `sales.order-cancel-tell` (Bao khach ket qua huy don): tells the customer, in their conversation, how their wish to cancel an order
 * ended: cancelled (`cancelled: true`, the cancel step's tool answered) or kept (`cancelled: false`, a person of the shop declined the
 * cancel on its card). The agent writes the line (no tool); the step sends it once with `nivo.tool.customer.message.send`. Split from the
 * cancel itself so the customer hears it only after the decision and the tool answered (the founder may decide long after the turn), and
 * so a failed message re-runs without touching the order again. A person declining the send on its card is a business outcome (`declined: true`); any other
 * refused send stops the run with the refusal.
 */
export const salesOrderCancelTellNode: TemplateNode<typeof input, typeof output> = defineTemplateNode({
    id: ID,
    title: bilingualOf("nodeSalesOrderCancelTellTitle"),
    description: {
        vi: "Báo khách kết quả yêu cầu huỷ đơn: đã huỷ khi việc huỷ đã xong, hoặc tiệm giữ đơn khi người của tiệm không đồng ý huỷ.",
        en: "Tells the customer how their wish to cancel ended: cancelled once the cancel is done, or kept when a person of the shop declined it.",
    },
    tools: [TOOL.customerMessageSend],
    mode: "auto",
    accounts: [PROVIDER.zaloOa, PROVIDER.telegram, PROVIDER.meta],
    input,
    output,
    model: "claude-sonnet-5-5",
    run: async (given, context) => {
        const { orderNo } = given
        if (orderNo === null) return context.fail({ kind: "cannot", why: "no order to tell the customer of" })
        const message = await context.agent.run({
            goal: `${messageOf("en", "nodeSalesOrderCancelTellGoal")}\n${given.cancelled ? GUIDANCE_CANCELLED : GUIDANCE_KEPT}`,
            input: { conversationId: given.conversationId, orderNo, cancelled: given.cancelled, locale: given.locale },
            output: written,
            tools: [],
            // One message is the work; the second turn only serves an answer the agent loop refused (no turn shape, an output that does not fit):
            // the model reads why and writes again instead of the step stopping confused on one slip (P-FIX2 list; as `sales.order-talk`).
            maxTurns: 2,
        })
        const said = await sayToCustomer(context, { text: message.text })
        if (!said.ok && said.declined) return { text: null, declined: true }
        saidOrCannot(context, said)
        return { text: message.text, declined: false }
    },
    examples: [
        {
            name: "the customer is told order DH-7 is cancelled, only after the cancel step's tool answered",
            params: {},
            input: { conversationId: "conv-1", orderNo: "DH-7", cancelled: true, locale: "en" },
            agent: [{ answer: { text: CANCELLED_DH7 } }],
            tools: [
                {
                    id: TOOL.customerMessageSend,
                    args: { text: CANCELLED_DH7 },
                    answer: sentAnswer("msg-2", "conv-1"),
                },
            ],
            output: { text: CANCELLED_DH7, declined: false },
        },
        {
            name: "a person declines the send: the customer is not told and the node says declined",
            params: {},
            input: { conversationId: "conv-1", orderNo: "DH-7", cancelled: true, locale: "en" },
            agent: [{ answer: { text: CANCELLED_DH7 } }],
            tools: [
                {
                    id: TOOL.customerMessageSend,
                    args: { text: CANCELLED_DH7 },
                    answer: refused("declined"),
                },
            ],
            output: { text: null, declined: true },
        },
        {
            name: "a refused send stops the run with the refusal; the order stays cancelled",
            params: {},
            input: { conversationId: "conv-1", orderNo: "DH-7", cancelled: true, locale: "en" },
            agent: [{ answer: { text: CANCELLED_DH7 } }],
            tools: [
                {
                    id: TOOL.customerMessageSend,
                    args: { text: CANCELLED_DH7 },
                    answer: refused("outside_window"),
                },
            ],
            failure: { kind: "cannot", why: `${TOOL.customerMessageSend} refused: outside_window` },
        },
        {
            name: "reached with no order number (a wiring fault: only a cancel that answered routes here): nothing is written or sent",
            params: {},
            input: { conversationId: "conv-1", orderNo: null, cancelled: true, locale: "en" },
            failure: { kind: "cannot", why: "no order to tell the customer of" },
        },
        {
            name: "a person of the shop declined the cancel: the customer is told the order stays and still waits for the payment",
            params: {},
            input: { conversationId: "conv-1", orderNo: "DH-7", cancelled: false, locale: "en" },
            agent: [{ answer: { text: KEPT_DH7 } }],
            tools: [
                {
                    id: TOOL.customerMessageSend,
                    args: { text: KEPT_DH7 },
                    answer: sentAnswer("msg-3", "conv-1"),
                },
            ],
            output: { text: KEPT_DH7, declined: false },
        },
    ],
})
