import { PROVIDER, TOOL } from "@nivo-lite/agent-sdk/names"
import { type TemplateNode, defineTemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { sentAnswer } from "@nivo-lite/blocks-core"
import { refused } from "../../../shared/nodes/web-answers"
import { TEXT_MAX, intakeTicketId } from "./desk-shapes"
import type { MailReply } from "./plan.node"
import { webdeskText } from "../copy"

/**
 * The route the sender's mail came on (the reply goes back on it), the reply the plan wrote (null when the plan wrote none), and the
 * ticket it is about.
 */
export interface MailReplyDraftInput {
    /** The route of the person who mailed: their conversation with the mailbox; the engine picks the channel and the account. */
    readonly routeId: string
    /** The reply to draft; null when none was composed. */
    readonly reply?: MailReply | null | undefined
    /** Null only on an item the graph ended `declined` before this step (`intakeTicketId`): then nothing is drafted. */
    readonly ticketId: string | null
}

/** Whether the reply was handed to a person to send, and the refusal when it was not. */
export interface MailReplyDraftOutput {
    /** True when the draft was saved. */
    readonly drafted: boolean
    /** Why the provider refused the call; null when it did not refuse. */
    readonly refusal: string | null
}

type NoParams = Record<string, never>

const params: z.ZodType<NoParams> = z.strictObject({})
const input: z.ZodType<MailReplyDraftInput> = z.object({
    routeId: z.string().min(1).max(200),
    reply: z.object({ subject: z.string().min(1).max(200), text: z.string().min(1).max(TEXT_MAX) }).nullish(),
    ticketId: intakeTicketId,
})
const output: z.ZodType<MailReplyDraftOutput> = z.object({
    drafted: z.boolean(),
    refusal: z.string().max(200).nullable(),
})

const DRAFT =
    "Chao anh/chi, ben em da ghi nhan yeu cau voi ma phieu TK-0002. Ky thuat dang kiem tra va se bao lai anh/chi ngay khi co ket qua."

const REPLY: MailReply = { subject: "Re: Web loi 500", text: DRAFT }

const SEND_ARGS = {
    routeId: "route-mail-1",
    subject: "Re: Web loi 500",
    text: DRAFT,
}

/**
 * `webdesk.mail-reply-draft` (Draft the mail reply): a side step split from `webdesk.mail-plan`. One call of the ONE customer send on the route
 * the person's mail came on (`{ routeId, subject, text }`: the engine picks the channel, the mail threads the reply) with the reply the
 * plan wrote; the mail goes only once a person approved it on the card (mode `ask`, MXW-1). No AI call.
 * A side step (`blocking: false`): without an SMTP account it is skipped and named on the agent page; a refusal is said in its output
 * and the ticket's note still follows; a person's `declined` of the draft is such a refusal (DECLINED rule 3: no notice, no outcome).
 * With no reply written, or no ticket, there is nothing to draft (exact checks).
 */
export const webdeskMailReplyDraftNode: TemplateNode<
    z.ZodType<MailReplyDraftInput>,
    z.ZodType<MailReplyDraftOutput>,
    z.ZodType<NoParams>
> = defineTemplateNode({
    id: "webdesk.mail-reply-draft",
    title: webdeskText("node.mail-reply-draft.title"),
    description: { vi: "So\u1ea1n th\u01b0 tr\u1ea3 l\u1eddi ng\u01b0\u1eddi g\u1eedi \u0111\u1ec3 ng\u01b0\u1eddi ph\u1ee5 tr\u00e1ch duy\u1ec7t tr\u01b0\u1edbc khi g\u1eedi.", en: "Drafts the reply to the sender for the person in charge to approve before it is sent." },
    tools: [TOOL.customerMessageSend],
    // R83 (owner, interim; the CEO reviews later): AI-written mail about money or a commitment asks, a person approves the whole
    // message on the approval card before it goes (`ask`).
    mode: "ask",
    accounts: [PROVIDER.smtp],
    params,
    input,
    output,
    blocking: false,
    sensitive: { reply: "pii" },
    run: async (given, context) => {
        if (given.reply === null || given.reply === undefined) return { drafted: false, refusal: null }
        if (given.ticketId === null) return { drafted: false, refusal: null }
        const drafted = await context.tools.call(TOOL.customerMessageSend, {
            routeId: given.routeId,
            subject: given.reply.subject,
            text: given.reply.text,
        })
        return drafted.ok ? { drafted: true, refusal: null } : { drafted: false, refusal: drafted.declined === true ? "declined" : drafted.refusal }
    },
    examples: [
        {
            name: "hands the drafted reply about the ticket to a person, who sends it",
            params: {},
            input: { routeId: "route-mail-1", reply: REPLY, ticketId: "TK-0002" },
            tools: [
                {
                    id: TOOL.customerMessageSend,
                    args: SEND_ARGS,
                    answer: sentAnswer("wi-1", "route-mail-1", "email"),
                },
            ],
            output: { drafted: true, refusal: null },
        },
        {
            name: "a declined draft is said in the output; the ticket goes on",
            params: {},
            input: { routeId: "route-mail-1", reply: REPLY, ticketId: "TK-0002" },
            tools: [{ id: TOOL.customerMessageSend, args: SEND_ARGS, answer: refused("declined") }],
            output: { drafted: false, refusal: "declined" },
        },
        {
            name: "no reply written: nothing is drafted",
            params: {},
            input: { routeId: "route-mail-1", reply: null, ticketId: "TK-0002" },
            output: { drafted: false, refusal: null },
        },
    ],
})
