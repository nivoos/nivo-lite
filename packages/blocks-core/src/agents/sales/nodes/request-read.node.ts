import { PROVIDER, TOOL } from "@nivo-lite/agent-sdk/names"
import { defineTemplateNode, type TemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { MAX_ID } from "../../../shared/bounds"
import { bilingualOf } from "../../../shared/messages/catalog"
import type { NodeSchema } from "../../../shared/nodes/node-schema.types"
import { answered, refused, valueOrCannot, viaAccount } from "../../../shared/nodes/tool-answers"

/** The neutral status words of a payment request (`nivo.tool.payment.request.get`). */
export const PAYMENT_REQUEST_STATUSES = ["open", "paid", "cancelled", "expired"] as const

/** The statuses that end a request with no payment: the payer can no longer pay it. */
export const PAYMENT_REQUEST_ENDED = ["cancelled", "expired"] as const

/** The request the order keeps. */
export interface RequestReadInput {
    /** The money provider's reference of the order's payment request (the order's `paymentRequestRef`); null when it keeps none. */
    readonly requestRef: string | null
}

/** Where the request stands. */
export interface RequestReadOutput {
    /** The neutral status, or null when there is no request to read (the provider keeps none). */
    readonly status: (typeof PAYMENT_REQUEST_STATUSES)[number] | null
}

const input: NodeSchema<RequestReadInput> = z.object({ requestRef: z.string().min(1).max(MAX_ID).nullable() })

const output: NodeSchema<RequestReadOutput> = z.object({
    status: z.enum(PAYMENT_REQUEST_STATUSES).nullable().describe("Where the payment request stands, or null when there is none to read."),
})

/** What the read answers, for the member the step hands on. */
const stateShape = z.object({ status: z.enum(PAYMENT_REQUEST_STATUSES) })

/** The reference of the examples (a payOS order code). */
const REF = "1789000000001"

/**
 * `sales.request-read` (Doc yeu cau thanh toan): reads the order's payment request at the money provider (`nivo.tool.payment.request.get`,
 * owner ruling R111) and hands on its neutral status, so the pay loop learns what changes at the provider with no event (the payer cancelled
 * at checkout, the request lapsed). With no reference (a provider that keeps no request) nothing is called and the status is null; a
 * provider that keeps none answers `no_request_state`, read the same way. Plain data: the graph decides.
 */
export const salesRequestReadNode: TemplateNode<typeof input, typeof output> = defineTemplateNode({
    id: "sales.request-read",
    title: bilingualOf("nodeSalesRequestReadTitle"),
    description: {
        vi: "Đọc tình trạng yêu cầu thanh toán của đơn ở nhà cung cấp: còn mở, đã trả, đã hủy hay hết hạn.",
        en: "Reads the order's payment request at the provider: still open, paid, cancelled or expired.",
    },
    tools: [TOOL.paymentRequestGet],
    mode: "auto",
    accounts: [PROVIDER.payos, PROVIDER.sepay],
    input,
    output,
    run: async (given, context) => {
        if (given.requestRef === null) return { status: null }
        const read = await context.tools.call(TOOL.paymentRequestGet, { requestRef: given.requestRef })
        if (!read.ok && read.refusal === "no_request_state") return { status: null }
        const state = stateShape.safeParse(valueOrCannot(context, TOOL.paymentRequestGet, read))
        if (!state.success) return context.fail({ kind: "cannot", why: `${TOOL.paymentRequestGet} answered an unknown shape` })
        return { status: state.data.status }
    },
    examples: [
        {
            name: "an open request is read by its reference",
            params: {},
            input: { requestRef: REF },
            tools: [
                {
                    id: TOOL.paymentRequestGet,
                    args: { requestRef: REF },
                    answer: answered({ requestRef: REF, amountVnd: 4500, status: "open", providerStatus: "PENDING" }, viaAccount(PROVIDER.payos)),
                },
            ],
            output: { status: "open" },
        },
        {
            name: "a request the payer cancelled at checkout reads cancelled (no event told NIVO)",
            params: {},
            input: { requestRef: REF },
            tools: [
                {
                    id: TOOL.paymentRequestGet,
                    args: { requestRef: REF },
                    answer: answered({ requestRef: REF, amountVnd: 4500, status: "cancelled", providerStatus: "CANCELLED" }, viaAccount(PROVIDER.payos)),
                },
            ],
            output: { status: "cancelled" },
        },
        {
            name: "a request past its validity reads expired",
            params: {},
            input: { requestRef: REF },
            tools: [
                {
                    id: TOOL.paymentRequestGet,
                    args: { requestRef: REF },
                    answer: answered({ requestRef: REF, amountVnd: 4500, status: "expired", providerStatus: "EXPIRED" }, viaAccount(PROVIDER.payos)),
                },
            ],
            output: { status: "expired" },
        },
        {
            name: "no reference (the provider keeps no request): nothing is called",
            params: {},
            input: { requestRef: null },
            tools: [],
            output: { status: null },
        },
        {
            name: "a provider that keeps no request answers no_request_state: read as no status",
            params: {},
            input: { requestRef: REF },
            tools: [{ id: TOOL.paymentRequestGet, args: { requestRef: REF }, answer: refused("no_request_state") }],
            output: { status: null },
        },
        {
            name: "a request the provider does not hold stops the run with the refusal",
            params: {},
            input: { requestRef: REF },
            tools: [{ id: TOOL.paymentRequestGet, args: { requestRef: REF }, answer: refused("not_found") }],
            failure: { kind: "cannot", why: `${TOOL.paymentRequestGet} refused: not_found` },
        },
    ],
})
