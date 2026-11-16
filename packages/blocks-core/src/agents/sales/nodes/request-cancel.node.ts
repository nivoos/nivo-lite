import { PROVIDER, TOOL } from "@nivo-lite/agent-sdk/names"
import { defineTemplateNode, type TemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { MAX_ID, MAX_LINE } from "../../../shared/bounds"
import { bilingualOf } from "../../../shared/messages/catalog"
import type { NodeSchema } from "../../../shared/nodes/node-schema.types"
import { answered, refused, valueOrCannot, viaAccount } from "../../../shared/nodes/tool-answers"
import { PAYMENT_REQUEST_STATUSES } from "./request-read.node"

/** The request of the order just cancelled, and why. */
export interface RequestCancelInput {
    /** The money provider's reference of the order's payment request; null when it keeps none. */
    readonly requestRef: string | null
    /** Why, in a few words, or null. */
    readonly reason: string | null
}

/** Whether a payable request was withdrawn. */
export interface RequestCancelOutput {
    /** True when the request was still payable and is now cancelled at the provider. */
    readonly withdrawn: boolean
    /** Where the request stands after the step, or null when there is none. */
    readonly status: (typeof PAYMENT_REQUEST_STATUSES)[number] | null
}

const input: NodeSchema<RequestCancelInput> = z.object({
    requestRef: z.string().min(1).max(MAX_ID).nullable(),
    reason: z.string().min(1).max(MAX_LINE).nullable(),
})

const output: NodeSchema<RequestCancelOutput> = z.object({
    withdrawn: z.boolean().describe("True when the still payable request was cancelled at the provider."),
    status: z.enum(PAYMENT_REQUEST_STATUSES).nullable().describe("Where the request stands after the step, or null when there is none."),
})

/** A request state as the read and the cancel answer it, for the member the step reads. */
const stateShape = z.object({ status: z.enum(PAYMENT_REQUEST_STATUSES) })

/** The reference of the examples. */
const REF = "1789000000001"

/** A state answer of the examples. */
const STATE = (status: string, providerStatus: string) =>
    answered({ requestRef: REF, amountVnd: 4500, status, providerStatus }, viaAccount(PROVIDER.payos))

/**
 * `sales.request-cancel` (Huy yeu cau thanh toan): after the order is cancelled, withdraws its payment request at the money provider so the
 * payer can no longer pay it (owner ruling R111). It reads the request first (`nivo.tool.payment.request.get`) and cancels it
 * (`nivo.tool.payment.request.cancel`) only while it is still payable (`open`): a request already paid, cancelled or expired is left as it
 * is. No reference, or a provider that keeps no request (`no_request_state`, declared final): nothing to withdraw. Any other refusal of the
 * cancel is a failed act: the engine stops the run for a person.
 */
export const salesRequestCancelNode: TemplateNode<typeof input, typeof output> = defineTemplateNode({
    id: "sales.request-cancel",
    title: bilingualOf("nodeSalesRequestCancelTitle"),
    description: {
        vi: "Rút lại yêu cầu thanh toán của đơn đã hủy ở nhà cung cấp, khi nó còn trả được.",
        en: "Withdraws the cancelled order's payment request at the provider while it is still payable.",
    },
    tools: [TOOL.paymentRequestGet, TOOL.paymentRequestCancel],
    mode: "auto",
    accounts: [PROVIDER.payos, PROVIDER.sepay],
    input,
    output,
    run: async (given, context) => {
        if (given.requestRef === null) return { withdrawn: false, status: null }
        const read = await context.tools.call(TOOL.paymentRequestGet, { requestRef: given.requestRef })
        if (!read.ok && read.refusal === "no_request_state") return { withdrawn: false, status: null }
        const now = stateShape.safeParse(valueOrCannot(context, TOOL.paymentRequestGet, read))
        if (!now.success) return context.fail({ kind: "cannot", why: `${TOOL.paymentRequestGet} answered an unknown shape` })
        if (now.data.status !== "open") return { withdrawn: false, status: now.data.status }
        const cancelled = await context.tools.call(TOOL.paymentRequestCancel, {
            requestRef: given.requestRef,
            ...(given.reason === null ? {} : { reason: given.reason }),
        })
        if (!cancelled.ok && cancelled.declined === true) return context.fail({ kind: "cannot", why: `${TOOL.paymentRequestCancel} declined` })
        if (!cancelled.ok && cancelled.refusal === "no_request_state") return { withdrawn: false, status: null }
        const after = stateShape.safeParse(valueOrCannot(context, TOOL.paymentRequestCancel, cancelled))
        if (!after.success) return context.fail({ kind: "cannot", why: `${TOOL.paymentRequestCancel} answered an unknown shape` })
        return { withdrawn: after.data.status === "cancelled", status: after.data.status }
    },
    examples: [
        {
            name: "an open request of the cancelled order is withdrawn at the provider",
            params: {},
            input: { requestRef: REF, reason: "the customer no longer needs it" },
            tools: [
                { id: TOOL.paymentRequestGet, args: { requestRef: REF }, answer: STATE("open", "PENDING") },
                {
                    id: TOOL.paymentRequestCancel,
                    args: { requestRef: REF, reason: "the customer no longer needs it" },
                    answer: STATE("cancelled", "CANCELLED"),
                },
            ],
            output: { withdrawn: true, status: "cancelled" },
        },
        {
            name: "a request the payer already cancelled at checkout is left as it is",
            params: {},
            input: { requestRef: REF, reason: null },
            tools: [{ id: TOOL.paymentRequestGet, args: { requestRef: REF }, answer: STATE("cancelled", "CANCELLED") }],
            output: { withdrawn: false, status: "cancelled" },
        },
        {
            name: "no reference (a bank-transfer instruction keeps no request): nothing to withdraw, nothing called",
            params: {},
            input: { requestRef: null, reason: null },
            tools: [],
            output: { withdrawn: false, status: null },
        },
        {
            name: "a provider that keeps no request answers no_request_state: nothing to withdraw",
            params: {},
            input: { requestRef: REF, reason: null },
            tools: [{ id: TOOL.paymentRequestGet, args: { requestRef: REF }, answer: refused("no_request_state") }],
            output: { withdrawn: false, status: null },
        },
        {
            name: "a cancel the provider refuses stops the run with the refusal",
            params: {},
            input: { requestRef: REF, reason: null },
            tools: [
                { id: TOOL.paymentRequestGet, args: { requestRef: REF }, answer: STATE("open", "PENDING") },
                { id: TOOL.paymentRequestCancel, args: { requestRef: REF }, answer: refused("rejected") },
            ],
            failure: { kind: "cannot", why: `${TOOL.paymentRequestCancel} refused: rejected` },
        },
    ],
})
