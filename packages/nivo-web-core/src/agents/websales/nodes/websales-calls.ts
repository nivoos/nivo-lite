import { TOOL, type ToolId } from "@nivo-lite/agent-sdk/names"
import type { JsonObject } from "@nivo-lite/agent-sdk/schema"
import {
    toolDeclined,
    toolOk,
    toolRefused,
    type DeclinedAnswer,
    type NodeContext,
    type ToolAnswer,
    type ToolAnswerOf,
    type ToolDeclined,
} from "@nivo-lite/agent-sdk/template"
import { sayToCustomer, valueOrCannot as coreValueOrCannot, type SayResult } from "@nivo-lite/blocks-core"
import { z } from "zod"
import { CRM_NIVOWEB } from "../../../shared/crm/nivoweb/api.generated"
import { type Purchase, purchaseSchema } from "./sales-shapes"

/** The kind of a team message: plain words. */
export const TEXT_KIND = "message.text"

/** The CRM's channel word of a purchase that came by mail (its enum, `CreatePurchaseRequest.channel`), and the channel of the ONE send that mails. */
export const MAIL_CHANNEL = "email"

/** The value of a tool's answer, or the node stops (blocks-core's shared reader, CONVENTIONS ADDENDUM 8). */
export const valueOrCannot: <A>(context: Pick<NodeContext, "fail">, id: ToolId, answer: ToolAnswer<A>) => A =
    coreValueOrCannot

/**
 * A value a node parses out of a tool's answer, or the node stops (an answer off the shape is a contract fault, not a choice).
 */
export const parsedOrCannot = <T>(
    context: Pick<NodeContext, "fail">,
    id: ToolId,
    schema: z.ZodType<T>,
    value: unknown,
): T => {
    const parsed = schema.safeParse(value)
    if (parsed.success) return parsed.data
    return context.fail({ kind: "cannot", why: `${id} answered off its shape` }, { issues: parsed.error.issues.length })
}

/** Reads one purchase of the CRM by its id (`purchase.get`, a read): the members the steps read, or the node stops. */
export const readPurchase = async (
    context: Pick<NodeContext, "tools" | "fail">,
    purchaseId: string,
): Promise<Purchase> => {
    const answer = await context.tools.call(CRM_NIVOWEB.get_purchases_id, { id: purchaseId })
    return parsedOrCannot(context, CRM_NIVOWEB.get_purchases_id, purchaseSchema, valueOrCannot(context, CRM_NIVOWEB.get_purchases_id, answer))
}

/**
 * How a customer can be reached, decided by the DATA the CRM holds (contract C3 data owner; never a provider choice): a purchase
 * that came through a conversation is answered in that conversation (its `sourceRef`: the send names no conversation, it tells the
 * person the run serves), a purchase that came by mail is mailed (the one send on the channel `email`) to
 * the mail address it holds (or the one given as the fallback, the customer's). None of the two: null, and the node says it
 * cannot.
 */
export type Reach =
    | { readonly by: "conversation"; readonly conversationId: string }
    | { readonly by: "mail"; readonly to: string }
    | { readonly by: "route"; readonly routeId: string }

/**
 * The reach of a purchase: its conversation, else a mail address (its own, else `fallbackMail`), else null. An exact check only.
 */
export const reachOf = (purchase: Purchase, fallbackMail: string | null = null): Reach | null => {
    if (purchase.channel !== MAIL_CHANNEL) return { by: "conversation", conversationId: purchase.sourceRef }
    const to = purchase.email ?? fallbackMail
    return to === null ? null : { by: "mail", to }
}

/** What the agent writes for a customer: the words, and a subject used only when the words go by mail. */
export type CustomerWords = {
    /** The subject of the customer's mail. */
    readonly subject: string
    /** The body of the customer's message. */
    readonly text: string
}

/**
 * What a customer send answered: the channel the words went through and the message id, both from the send's own receipt
 * (`value.channel`: `website` for NIVO's own website chat, `email` for a mail; the send is a NIVO effect, `answer.via.provider` is null).
 */
export type Told = {
    /** The channel the message went out on. */
    readonly channel: string
    /** The reference the provider gave the message that went out (else the send's once-key). */
    readonly messageRef: string
}

/** What the customer send answers (its receipt, a mail's too): the channel it went through, the provider's message id (null when none came back) and the once-key. */
const sentSchema = z.looseObject({
    sendKey: z.string().min(1).max(200),
    providerMessageId: z.string().min(1).max(200).nullish(),
    channel: z.string().min(1).max(40),
})

/** The refusal of an `ask` call a person declined: a person's decision the node reads, never an error (ADDENDUM 2 point 5). */
export const DECLINED = "declined"

/**
 * True when a person declined the approval the call asked for: the answer's `declined` member. It narrows the declined answer out of
 * the rest, so the code after it reads `refusal` of a real refusal only.
 */
export const isDeclined = <A extends { readonly ok: boolean; readonly declined?: boolean | undefined }>(
    answer: A,
): answer is Extract<A, ToolDeclined> => !answer.ok && answer.declined === true

/** What a customer send answers: the receipt as the value (a mail's too), a refusal, or a person's decline. */
type CustomerSendAnswer =
    | ToolAnswer<JsonObject>
    | DeclinedAnswer
    | ToolAnswerOf<typeof TOOL.customerMessageSend>

/** What a customer send answered: what it told, or the send's business refusal (a fact the node reads). */
export type Sent = { readonly ok: true; readonly told: Told } | { readonly ok: false; readonly refusal: string }

/** The arguments of the ONE send that mails: the channel `email`, the address, the subject and the words. */
export const mailArgsOf = (to: string, words: CustomerWords): JsonObject => ({
    channel: MAIL_CHANNEL,
    address: to,
    subject: words.subject,
    text: words.text,
})

/** The arguments of the ONE send on a person's route (a mail that came in): the route, the subject and the words; the engine picks the channel and threads the reply. */
export const routeArgsOf = (routeId: string, words: CustomerWords): JsonObject => ({
    routeId,
    subject: words.subject,
    text: words.text,
})

/** The chat send's answer as the nodes read an answer: the receipt as the value, a refusal, or the person's decline. */
const answerOf = (said: SayResult): ToolAnswer<JsonObject> | DeclinedAnswer => {
    if (said.ok) return toolOk(said.facts)
    return said.declined ? toolDeclined(said.facts) : toolRefused(said.refusal, said.facts)
}

/** The context a customer send needs: the shared helper's. */
type SendContext = Pick<NodeContext, "tools" | "fail" | "run" | "workspace">

/** The ONE send of the reach: through the shared helper to the person the run serves (a conversation), or on the channel `email` to the address (a mail). */
const sendOf = async (context: SendContext, reach: Reach, words: CustomerWords): Promise<CustomerSendAnswer> => {
    if (reach.by === "conversation") return answerOf(await sayToCustomer(context, { text: words.text }))
    if (reach.by === "route") return context.tools.call(TOOL.customerMessageSend, routeArgsOf(reach.routeId, words))
    return context.tools.call(TOOL.customerMessageSend, mailArgsOf(reach.to, words))
}

/**
 * What the send told, read from its ok answer's value (the receipt): the message reference (the provider's id, else the once-key) and the
 * channel it went on.
 */
const toldOf = (context: Pick<NodeContext, "fail">, value: unknown): Told => {
    const sent = parsedOrCannot(context, TOOL.customerMessageSend, sentSchema, value)
    return { channel: sent.channel, messageRef: sent.providerMessageId ?? sent.sendKey }
}

/**
 * The node's ONE customer write, the ONE customer send: to the person the run serves (`sayToCustomer`) when the reach is a conversation,
 * on the channel `email` to the address when it is a mail. A refusal (a person's `declined` included) is answered, not
 * thrown: the caller decides what a refusal means for its step. The answer's value names the channel.
 */
export const sendToCustomer = async (
    context: SendContext,
    reach: Reach,
    words: CustomerWords,
): Promise<Sent> => {
    const answer = await sendOf(context, reach, words)
    if (!answer.ok) return { ok: false, refusal: answer.declined === true ? DECLINED : answer.refusal }
    return { ok: true, told: toldOf(context, answer.value) }
}

/**
 * The node's ONE customer write, which must go through: a person who declined the send made a decision, answered `null` (the node
 * returns it as `declined`, never fails on it, DECLINED rule); any other refusal stops the node (`cannot`, with the refusal and its
 * facts).
 */
export const tellCustomer = async (
    context: SendContext,
    reach: Reach,
    words: CustomerWords,
): Promise<Told | null> => {
    const answer = await sendOf(context, reach, words)
    if (isDeclined(answer)) return null
    return toldOf(context, valueOrCannot(context, TOOL.customerMessageSend, answer))
}

/** One team line: what it asks of a person or tells them, a short title and the words. */
export type TeamLine = {
    /** What the line is for: asking, notifying or reporting. */
    readonly intent: "ask" | "notify" | "report"
    /** The title, as shown in the team notice or document. */
    readonly title: string
    /** The text of the line. */
    readonly text: string
}

/** Whether the team line was posted, and the post tool's refusal when it was not. */
export type Posted = {
    /** True when the team notice was posted. */
    readonly posted: boolean
    /** Why the post was refused; null when it was not. */
    readonly refusal: string | null
}

/**
 * The node's ONE team write (`TOOL.teamMessagePost`, NIVO's own): a refusal is read and returned, a team line never stops the run.
 */
export const postTeam = async (context: Pick<NodeContext, "tools">, line: TeamLine): Promise<Posted> => {
    const answer = await context.tools.call(TOOL.teamMessagePost, { kind: TEXT_KIND, audience: "own", ...line })
    return answer.ok ? { posted: true, refusal: null } : { posted: false, refusal: answer.declined === true ? DECLINED : answer.refusal }
}

/** The team post's arguments as an example asserts them. */
export const postArgsOf = (line: TeamLine): JsonObject => ({ kind: TEXT_KIND, audience: "own", ...line })

/** The schema of a team line the agent writes (the intent is the node's, from its input). */
export const teamWordsSchema: z.ZodType<{ readonly title: string; readonly text: string }> = z.object({
    title: z
        .string()
        .min(1)
        .max(200)
        .describe("A short title in the team's language, holding the purchase code when there is one."),
    text: z.string().min(1).max(2000).describe("The line, in the team's language (`locale`)."),
})

/** The schema of the words the agent writes for a customer. */
export const customerWordsSchema: z.ZodType<CustomerWords> = z.object({
    subject: z
        .string()
        .min(1)
        .max(200)
        .describe("A short mail subject in the customer's language (used only when the words are mailed)."),
    text: z.string().min(1).max(2000).describe("The words for the customer, in their language, plain text."),
})

