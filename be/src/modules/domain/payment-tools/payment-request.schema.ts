import { z } from "zod"
import type { ToolJson } from "@modules/domain/tools"

/**
 * The bounded arguments of the payment-request tools (`nivo.tool.payment.request.*`, owner ruling R111).
 *
 * The reference bound is the strictest transfer-content limit among the providers that ask the payer to write it: SePay's documented limit
 * of the transfer description, 94 characters (https://docs.sepay.vn/tao-qr-code-vietqr-dong.html: `des`, up to 94 characters). A provider
 * with a stricter limit of its own text (payOS: 9 characters for a bank account not linked through payOS, `PAYOS_OPS.createLink`) never
 * puts the reference there whole: its adapter fits its own text, and a paid event is matched by the request reference, never by the words.
 * The amount is a positive whole number of dong: no provider documentation read states a ceiling, so none is invented (the safe-integer
 * bound only keeps it exact).
 */
export const REQUEST_REFERENCE_MAX = 94

/** The longest request reference the tools take (ours: a provider order code as text is far shorter). */
const REQUEST_REF_MAX = 100

/** The longest cancellation reason (ours). */
const REASON_MAX = 255

export const REQUEST_CREATE_SCHEMA: z.ZodType<{ amountVnd: number; reference: string; expiresAt?: string | undefined }> = z
    .object({
        amountVnd: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).describe("The amount to pay, in VND (a positive whole number)."),
        reference: z
            .string()
            .trim()
            .min(1)
            .max(REQUEST_REFERENCE_MAX)
            .describe("Your own reference of what is paid for (an order code). Up to 94 characters. Answered untouched."),
        expiresAt: z.iso
            .datetime({ offset: true })
            .max(64)
            .optional()
            .describe("When the request stops being payable, ISO 8601 with an offset; absent keeps the provider's own default."),
    })
    .strict()

const requestRef = z.string().trim().min(1).max(REQUEST_REF_MAX).describe("The provider's reference of the request, as the create answered it (`requestRef`).")

export const REQUEST_GET_SCHEMA: z.ZodType<{ requestRef: string }> = z.object({ requestRef }).strict()

export const REQUEST_CANCEL_SCHEMA: z.ZodType<{ requestRef: string; reason?: string | undefined }> = z
    .object({ requestRef, reason: z.string().min(1).max(REASON_MAX).optional().describe("Why the request is cancelled (optional).") })
    .strict()

/** The schemas the manifest announces, generated from the validators. */
export const REQUEST_CREATE_INPUT_SCHEMA: ToolJson = z.toJSONSchema(REQUEST_CREATE_SCHEMA, { io: "input" })
export const REQUEST_GET_INPUT_SCHEMA: ToolJson = z.toJSONSchema(REQUEST_GET_SCHEMA, { io: "input" })
export const REQUEST_CANCEL_INPUT_SCHEMA: ToolJson = z.toJSONSchema(REQUEST_CANCEL_SCHEMA, { io: "input" })
