import { TOOL } from "@nivo-lite/agent-sdk/names"
import type { JsonObject } from "@nivo-lite/agent-sdk/schema"
import type { NodeContext } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { BODY_MAX } from "./books-shapes"

/*
 * The customer mail of the Accounting steps. It replaces the `send_email` work item: the agent WRITES the mail
 * (or decides none, ADDENDUM 10) and the node makes its one write, the ONE customer send (`TOOL.customerMessageSend`) on the channel
 * `email` (provider `smtp`), in the node's own mode. The arguments are the send's own (`{ channel: "email", address, subject, text }`: the
 * engine meets the person by the address; the run and the step are on the delivery ledger, so the record the mail is about is carried by
 * them, not by an argument); its answer is the delivery receipt (`sendKey`, `channel`, `routeId`, `delivered`).
 */

/** The mail the agent writes, addressed to the address the CRM answered. */
export interface CustomerMail {
    /** The customer's e-mail, exactly as the CRM answered it. */
    readonly to: string
    /** The subject, in the customer's language. */
    readonly subject: string
    /** The plain body, in the customer's language. */
    readonly body: string
}

/** The schema of the mail the agent writes; null when no mail goes. */
export const customerMailSchema: z.ZodType<CustomerMail | null> = z
    .object({
        to: z.string().min(3).max(320).describe("The customer's e-mail exactly as the CRM answered it."),
        subject: z.string().min(1).max(200).describe("The subject, in the customer's language."),
        body: z.string().min(1).max(BODY_MAX).describe("The plain body, in the customer's language."),
    })
    .nullable()

/**
 * What became of the mail: the reference the send answered (its once-key), or the refusal it gave (the person declined, the address
 * bounced, the mail had no subject).
 */
export interface MailResult {
    /** The send's once-key (the delivery ledger's row of the mail); null when nothing was sent. */
    readonly messageRef: string | null
    /** Why the provider refused the call; null when it did not refuse. */
    readonly refusal: string | null
}

/** The channel of the one customer send that carries a mail (the workspace's mail account, provider `smtp`). */
const MAIL_CHANNEL = "email"

/** The args of the send (also what an example asserts): the channel `email`, the CRM's address, the subject and the words. */
export const mailArgsOf = (mail: CustomerMail): JsonObject => ({
    channel: MAIL_CHANNEL,
    address: mail.to,
    subject: mail.subject,
    text: mail.body,
})

/**
 * Sends the mail (on `auto` the call sends it; on a shop's own `ask` the engine asked first) and reads its answer or its refusal, in code: the
 * receipt's `sendKey` is the reference; a refusal (a shop's own `ask` declined included) is answered as a fact.
 */
export const sendCustomerMail = async (ctx: NodeContext, mail: CustomerMail): Promise<MailResult> => {
    const sent = await ctx.tools.call(TOOL.customerMessageSend, mailArgsOf(mail))
    if (!sent.ok) return { messageRef: null, refusal: sent.declined === true ? "declined" : sent.refusal }
    const sendKey = sent.value["sendKey"]
    return { messageRef: typeof sendKey === "string" ? sendKey : null, refusal: null }
}
