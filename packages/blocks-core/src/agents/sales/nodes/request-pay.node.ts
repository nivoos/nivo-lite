import { PROVIDER, TOOL } from "@nivo-lite/agent-sdk/names"
import { defineTemplateNode, type TemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { MAX_ID, MAX_LINE } from "../../../shared/bounds"
import { bilingualOf } from "../../../shared/messages/catalog"
import type { NodeSchema } from "../../../shared/nodes/node-schema.types"
import { answered, refused, valueOrCannot, viaAccount } from "../../../shared/nodes/tool-answers"
import { SALES_ORDER_ENTITY } from "../../../shared/entities/sales-entity-names"

/** The order the payer is asked to pay: its record, its code (the reference) and its exact total. */
export interface RequestPayInput {
    /** The order's record. */
    readonly orderId: string
    /** The order's code: the reference the request is made for. */
    readonly orderNo: string
    /** The order's exact total, VND. */
    readonly amountVnd: number
}

/** The bank account the payer transfers into, when the provider named it. */
export type PaymentRequestBank = {
    /** The receiving account's number. */
    readonly accountNumber: string
    /** The bank's code, or null. */
    readonly code: string | null
    /** The bank's name, or null. */
    readonly name: string | null
    /** The receiving account's holder, or null. */
    readonly holder: string | null
}

/**
 * The payment request the money provider of the account issued, in the neutral words of `nivo.tool.payment.request.create`: what the payer
 * needs, as the provider gave it (null where it gave nothing), and the provider's own reference of the request when it keeps one.
 */
export interface PaymentRequest {
    /** The amount, VND, as the provider keeps it. */
    readonly amountVnd: number
    /** The order's code, as asked. */
    readonly reference: string
    /** The address of a page where the payer pays, or null. */
    readonly payUrl: string | null
    /** The address of a QR PICTURE, or null. */
    readonly qrImageUrl: string | null
    /** The raw QR payload (text, never a picture), or null. */
    readonly qrPayload: string | null
    /** The words the payer writes on the transfer, or null when the provider does not recognise the payment by them. */
    readonly transferContent: string | null
    /** The bank account to transfer into, or null. */
    readonly bank: PaymentRequestBank | null
    /** The provider's own reference of the request, or null when it keeps none. */
    readonly requestRef: string | null
    /** What the provider's paid event of the request carries as its `payKey`: the pay wait matches it. */
    readonly payKey: string
}

/** The longest address the step keeps. */
const MAX_URL = 2048

/** The longest reference or transfer content the tool takes (its bound). */
const MAX_REFERENCE = 94

/** The longest QR payload the step keeps (an EMVCo payload is a few hundred characters). */
const MAX_PAYLOAD = 1024

const input: NodeSchema<RequestPayInput> = z.object({
    orderId: z.string().min(1).max(MAX_ID),
    orderNo: z.string().min(1).max(MAX_REFERENCE),
    amountVnd: z.number().int().positive(),
})

const bankShape = z.object({
    accountNumber: z.string().min(1).max(MAX_ID).describe("The receiving account's number."),
    code: z.string().min(1).max(MAX_ID).nullable().describe("The bank's code, or null."),
    name: z.string().min(1).max(MAX_LINE).nullable().describe("The bank's name, or null."),
    holder: z.string().min(1).max(MAX_LINE).nullable().describe("The receiving account's holder, or null."),
})

const output: NodeSchema<PaymentRequest> = z.object({
    amountVnd: z.number().int().positive().describe("The amount to pay, VND: the order's exact total."),
    reference: z.string().min(1).max(MAX_REFERENCE).describe("The order's code."),
    payUrl: z.string().min(1).max(MAX_URL).nullable().describe("The address of a page where the payer pays, or null."),
    qrImageUrl: z.string().min(1).max(MAX_URL).nullable().describe("The address of a QR picture, or null."),
    qrPayload: z.string().min(1).max(MAX_PAYLOAD).nullable().describe("The raw QR payload (text, never a picture), or null."),
    transferContent: z.string().min(1).max(MAX_REFERENCE).nullable().describe("The words the payer writes on the transfer, or null."),
    bank: bankShape.nullable().describe("The bank account to transfer into, or null."),
    requestRef: z.string().min(1).max(MAX_ID).nullable().describe("The provider's reference of the request, or null when it keeps none."),
    payKey: z.string().min(1).max(MAX_REFERENCE).describe("What the provider's paid event of the request carries as its payKey."),
})

/** What `nivo.tool.payment.request.create` answers, read for the members the step hands on. */
const answerShape = z.object({
    amountVnd: z.number().int().positive(),
    reference: z.string().min(1).max(MAX_REFERENCE),
    payUrl: z.string().min(1).max(MAX_URL).optional(),
    qrImageUrl: z.string().min(1).max(MAX_URL).optional(),
    qrPayload: z.string().min(1).max(MAX_PAYLOAD).optional(),
    transferContent: z.string().min(1).max(MAX_REFERENCE).optional(),
    bank: z
        .object({
            accountNumber: z.string().min(1).max(MAX_ID),
            code: z.string().min(1).max(MAX_ID).optional(),
            name: z.string().min(1).max(MAX_LINE).optional(),
            holder: z.string().min(1).max(MAX_LINE).optional(),
        })
        .optional(),
    requestRef: z.string().min(1).max(MAX_ID).optional(),
    payKey: z.string().min(1).max(MAX_REFERENCE),
})

/** The record update that keeps the request's reference on the order (the pay loop, a cancel and a later run read it there). */
const KEEP_REF_OF = (orderId: string, requestRef: string) => ({
    type: SALES_ORDER_ENTITY,
    id: orderId,
    patch: { paymentRequestRef: requestRef },
})

/** The order of the examples. */
const ORDER: RequestPayInput = { orderId: "o1", orderNo: "DH-20261113-0001", amountVnd: 4500 }

/** The ask of the examples: the order's exact total and its code. */
const ASK = { amountVnd: 4500, reference: "DH-20261113-0001" }

/** A bank-transfer instruction, as the tool answers it for a SePay account (no request kept). */
const INSTRUCTION = {
    amountVnd: 4500,
    reference: "DH-20261113-0001",
    status: "open",
    qrImageUrl: "https://vietqr.app/img?acc=123456&bank=ACB&amount=4500&des=DH-20261113-0001",
    transferContent: "DH-20261113-0001",
    bank: { accountNumber: "123456", code: "ACB", holder: "HOA SHOP" },
    payKey: "DH-20261113-0001",
}

/** A hosted link, as the tool answers it for a payOS account (a request kept under payOS's order code). */
const LINK = {
    amountVnd: 4500,
    reference: "DH-20261113-0001",
    status: "open",
    payUrl: "https://pay.payos.vn/web/124c33293c43417ab7879e14c8d9eb18",
    qrPayload: "00020101021238570010A000000727",
    requestRef: "1789000000001",
    payKey: "1789000000001",
}

/**
 * `sales.request-pay` (Yeu cau khach thanh toan): asks the payer to pay the order's exact total for its code
 * (`nivo.tool.payment.request.create`, owner ruling R111) through the money account the pick order chose (the node lists [payOS, SePay];
 * the seed's node setting or the agent's default decides): the node holds no provider branch and hands on what the provider gave, in the
 * neutral words. When the provider keeps the request (`requestRef`), the order's record keeps the reference (`paymentRequestRef`), so the pay
 * loop reads the request at every wake and a cancel withdraws it. A refusal stops the run with it: the engine reports it to the team.
 */
export const salesRequestPayNode: TemplateNode<typeof input, typeof output> = defineTemplateNode({
    id: "sales.request-pay",
    title: bilingualOf("nodeSalesRequestPayTitle"),
    description: {
        vi: "Yêu cầu khách thanh toán đúng tổng tiền của đơn qua tài khoản nhận tiền của shop (link thanh toán, mã QR hoặc thông tin chuyển khoản, tùy nhà cung cấp).",
        en: "Asks the customer to pay the order's exact total through the shop's money account (a pay link, a QR or the transfer details, as the provider gives).",
    },
    tools: [TOOL.paymentRequestCreate],
    mode: "auto",
    accounts: [PROVIDER.payos, PROVIDER.sepay],
    input,
    output,
    run: async (given, context) => {
        const requested = await context.tools.call(TOOL.paymentRequestCreate, { amountVnd: given.amountVnd, reference: given.orderNo })
        // The node declares `auto`; a shop that sets it to `ask` and declines leaves the order with no request: the step cannot go on.
        if (!requested.ok && requested.declined === true) return context.fail({ kind: "cannot", why: `${TOOL.paymentRequestCreate} declined` })
        const answer = answerShape.safeParse(valueOrCannot(context, TOOL.paymentRequestCreate, requested))
        if (!answer.success) return context.fail({ kind: "cannot", why: `${TOOL.paymentRequestCreate} answered an unknown shape` })
        const asked = answer.data
        if (asked.requestRef !== undefined) {
            const kept = await context.tools.call(TOOL.recordUpdate, KEEP_REF_OF(given.orderId, asked.requestRef))
            if (!kept.ok && kept.declined === true) return context.fail({ kind: "cannot", why: `${TOOL.recordUpdate} declined` })
            valueOrCannot(context, TOOL.recordUpdate, kept)
        }
        return {
            amountVnd: asked.amountVnd,
            reference: asked.reference,
            payUrl: asked.payUrl ?? null,
            qrImageUrl: asked.qrImageUrl ?? null,
            qrPayload: asked.qrPayload ?? null,
            transferContent: asked.transferContent ?? null,
            bank:
                asked.bank === undefined
                    ? null
                    : {
                          accountNumber: asked.bank.accountNumber,
                          code: asked.bank.code ?? null,
                          name: asked.bank.name ?? null,
                          holder: asked.bank.holder ?? null,
                      },
            requestRef: asked.requestRef ?? null,
            payKey: asked.payKey,
        }
    },
    examples: [
        {
            name: "a payOS account: a pay link under payOS's order code; the order keeps the request's reference",
            params: {},
            input: ORDER,
            tools: [
                { id: TOOL.paymentRequestCreate, args: ASK, answer: answered(LINK, viaAccount(PROVIDER.payos)) },
                {
                    id: TOOL.recordUpdate,
                    args: KEEP_REF_OF("o1", "1789000000001"),
                    answer: answered({
                        record: {
                            id: "o1",
                            version: "2",
                            createdAt: "2026-11-13T08:00:00.000Z",
                            updatedAt: "2026-11-13T08:00:01.000Z",
                            values: { orderNo: "DH-20261113-0001", paymentRequestRef: "1789000000001" },
                        },
                    }),
                },
            ],
            output: {
                amountVnd: 4500,
                reference: "DH-20261113-0001",
                payUrl: LINK.payUrl,
                qrImageUrl: null,
                qrPayload: LINK.qrPayload,
                transferContent: null,
                bank: null,
                requestRef: "1789000000001",
                payKey: "1789000000001",
            },
        },
        {
            name: "a SePay account: the same node, the same call; a bank-transfer instruction with no request kept, so the order is not touched",
            params: {},
            input: ORDER,
            tools: [{ id: TOOL.paymentRequestCreate, args: ASK, answer: answered(INSTRUCTION, viaAccount(PROVIDER.sepay)) }],
            output: {
                amountVnd: 4500,
                reference: "DH-20261113-0001",
                payUrl: null,
                qrImageUrl: INSTRUCTION.qrImageUrl,
                qrPayload: null,
                transferContent: "DH-20261113-0001",
                bank: { accountNumber: "123456", code: "ACB", name: null, holder: "HOA SHOP" },
                requestRef: null,
                payKey: "DH-20261113-0001",
            },
        },
        {
            name: "a refused request (no money account connected) stops the run with the refusal",
            params: {},
            input: ORDER,
            tools: [{ id: TOOL.paymentRequestCreate, args: ASK, answer: refused("not_connected") }],
            failure: { kind: "cannot", why: `${TOOL.paymentRequestCreate} refused: not_connected` },
        },
        {
            name: "a request the provider refused (rejected) stops the run with the refusal; the order is not touched",
            params: {},
            input: ORDER,
            tools: [{ id: TOOL.paymentRequestCreate, args: ASK, answer: refused("rejected") }],
            failure: { kind: "cannot", why: `${TOOL.paymentRequestCreate} refused: rejected` },
        },
    ],
})
