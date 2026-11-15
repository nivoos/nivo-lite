import { PROVIDER, TOOL } from "@nivo-lite/agent-sdk/names"
import { type TemplateNode, defineTemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { webbooksText } from "../copy"
import { creditsOk, refused } from "./books.fixtures"
import { idSchema } from "./books-shapes"

/** What woke the graph: the id of the raw bank row the credit trigger names. */
const input = z.object({ transactionId: idSchema })

/**
 * One credit as `nivo.tool.payment.credit.get` answers it: the ONE movement named by the provider's id of it (the row's key, the id the
 * bank trigger's event carries), the same shape for every bank feed.
 */
const creditRow = z.object({
    id: idSchema,
    direction: z.enum(["in", "out"]),
    amountVnd: z.number().int(),
    content: z.string().max(400),
})

/** The credit, exactly as the raw row holds it. */
const output = z.object({
    transactionRef: idSchema.describe("The `id` of the credit, as the bank feed names it."),
    amountVnd: z.number().int().describe("The amount received, in whole VND."),
    reference: z.string().max(400).nullable().describe("The transfer text the payer wrote; null when none."),
})

const creditOf = (id: string, amountVnd: number, content: string) => ({
    id,
    direction: "in",
    amountVnd,
    content,
    at: "2026-11-12T02:00:00.000Z",
})

const CREDIT = creditOf("sepay:9100002", 1_188_000, "GH8K2Q chuyen tien gia han")

/**
 * `webbooks.payment-credit` (Read the credit): the ONE movement the credit trigger names, read exactly by the provider's id of it
 * (`TOOL.paymentCreditGet`: the id the event carries as `data.transactionId`, the same read and shape the Sales agent's credit step uses
 * for every bank feed). No model, no comparison with any request: the next steps do both. A credit the read does not answer is not
 * clear: confused, with the facts, so the founder decides. The transfer text is a person's words (private).
 */
export const webbooksPaymentCreditNode: TemplateNode = defineTemplateNode({
    id: "webbooks.payment-credit",
    title: webbooksText("node.payment-credit.title"),
    description: { vi: "Đọc khoản tiền ngân hàng vừa báo có.", en: "Reads the bank credit that just came in." },
    tools: [TOOL.paymentCreditGet],
    mode: "auto",
    accounts: [PROVIDER.sepay, PROVIDER.casso],
    input,
    output,
    sensitive: { reference: "pii" },
    run: async (given, ctx) => {
        const read = await ctx.tools.call(TOOL.paymentCreditGet, { transactionId: given.transactionId })
        if (!read.ok)
            return ctx.fail({ kind: "confused", question: null }, { transactionId: given.transactionId, refusal: read.refusal })
        const credit = creditRow.safeParse(read.value)
        if (!credit.success)
            return ctx.fail({ kind: "confused", question: null }, { transactionId: given.transactionId, found: false })
        return { transactionRef: credit.data.id, amountVnd: credit.data.amountVnd, reference: credit.data.content }
    },
    examples: [
        {
            name: "reads the credit the trigger names, exactly, by its id",
            params: {},
            input: { transactionId: "sepay:9100002" },
            tools: [{ id: TOOL.paymentCreditGet, args: { transactionId: "sepay:9100002" }, answer: creditsOk(CREDIT) }],
            output: { transactionRef: "sepay:9100002", amountVnd: 1_188_000, reference: "GH8K2Q chuyen tien gia han" },
        },
        {
            name: "the read refuses the credit (not one of the account's): confused, with the facts, for the founder",
            params: {},
            input: { transactionId: "sepay:9999999" },
            tools: [{ id: TOOL.paymentCreditGet, args: { transactionId: "sepay:9999999" }, answer: refused("not_found") }],
            failure: { kind: "confused", question: null },
        },
    ],
})
