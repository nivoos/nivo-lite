import { TOOL } from "@nivo-lite/agent-sdk/names"
import { type TemplateNode, defineTemplateNode } from "@nivo-lite/agent-sdk/template"
import { z } from "zod"
import { MAX_ID, MAX_LINE } from "../../../shared/bounds"
import { bilingualOf } from "../../../shared/messages/catalog"
import type { NodeSchema } from "../../../shared/nodes/node-schema.types"
import { answered, refused, valueOrCannot } from "../../../shared/nodes/tool-answers"

type NoParams = Record<string, never>

/** The person who asked to be left alone, and why in the words the front desk's decision wrote. */
export interface StopKeepInput {
    /** The person, or null while the conversation has none (then there is nobody to keep the request for). */
    readonly contactId: string | null
    /** One line in Vietnamese: what the person asked, from the front desk's decision (the reason the engine keeps). */
    readonly reason: string
}

/** Whether the request was kept. */
export interface StopKeepOutput {
    /** True once the person's "do not contact" is on their contact. */
    readonly kept: boolean
    /** True when a person declined keeping it on its card: nothing was kept; the engine reports it. */
    readonly declined: boolean
}

const params: NodeSchema<NoParams> = z.strictObject({})
const input: NodeSchema<StopKeepInput> = z.object({
    contactId: z.string().min(1).max(MAX_ID).nullable(),
    reason: z.string().min(1).max(MAX_LINE),
})
const output: NodeSchema<StopKeepOutput> = z.object({
    kept: z.boolean(),
    declined: z.boolean().describe("True when a person declined keeping the request on its card: nothing was kept."),
})

const REASON = "Kh\u00e1ch xin \u0111\u1eebng nh\u1eafn tin ch\u1ee7 \u0111\u1ed9ng"

/**
 * `chatbot.stop-keep` (Ghi nho khach khong muon duoc nhan tin): when the front desk judged that the person asked the shop to stop
 * messaging them, writes it as the contact's ONE consent fact (`nivo.tool.contact.update` with `doNotContact: { reason }`; no clearing
 * argument: only a person clears it). A plain tool call: the decision was the model's, here nothing is judged; the node asks first (mode
 * `ask`: a team member approves the write on its card). The engine's send door
 * then refuses a message the shop STARTS to that person, and still allows an answer on their own line. With no person there is nothing to
 * keep and the step stops (`cannot`, the engine reports it); a person declining it on its card (mode `ask`) is the step's unsuccessful ending.
 */
export const chatbotStopKeepNode: TemplateNode<NodeSchema<StopKeepInput>, NodeSchema<StopKeepOutput>, NodeSchema<NoParams>> =
    defineTemplateNode({
        id: "chatbot.stop-keep",
        title: bilingualOf("nodeChatbotStopKeepTitle"),
        description: { vi: "Ghi l\u1ea1i tr\u00ean li\u00ean h\u1ec7 r\u1eb1ng kh\u00e1ch xin \u0111\u1eebng nh\u1eafn tin ch\u1ee7 \u0111\u1ed9ng; ch\u1ec9 ng\u01b0\u1eddi th\u1eadt m\u1edbi g\u1ee1 \u0111\u01b0\u1ee3c.", en: "Records on the contact that the customer asked not to be messaged first; only a person can lift it." },
        tools: [TOOL.contactUpdate],
        // Ask first: a do-not-contact fact silences the shop for good (only a person lifts it), and the front desk's reading can be wrong, so a
        // team member says yes on the card before it is written.
        mode: "ask",
        accounts: [],
        params,
        input,
        output,
        run: async (given, context) => {
            if (given.contactId === null) return context.fail({ kind: "cannot", why: "there is no person to keep the request for" })
            const kept = await context.tools.call(TOOL.contactUpdate, { doNotContact: { reason: given.reason } })
            if (!kept.ok && kept.declined === true) return { kept: false, declined: true }
            valueOrCannot(context, TOOL.contactUpdate, kept)
            return { kept: true, declined: false }
        },
        examples: [
            {
                name: "a person who asked the shop to stop messaging them: the contact keeps it with the reason",
                params: {},
                input: { contactId: "c1", reason: REASON },
                tools: [
                    {
                        id: TOOL.contactUpdate,
                        args: { doNotContact: { reason: REASON } },
                        answer: answered({ contactId: "c1", doNotContact: true }),
                    },
                ],
                output: { kept: true, declined: false },
            },
            {
                name: "a person declines keeping it on its card: nothing is kept and the step says declined",
                params: {},
                input: { contactId: "c1", reason: REASON },
                tools: [{ id: TOOL.contactUpdate, args: { doNotContact: { reason: REASON } }, answer: refused("declined") }],
                output: { kept: false, declined: true },
            },
            {
                name: "no person yet: nothing to keep it for, the step stops for the engine's report",
                params: {},
                input: { contactId: null, reason: REASON },
                failure: { kind: "cannot", why: "there is no person to keep the request for" },
            },
            {
                name: "a refusal of the update other than a decline stops the step, never reported as kept",
                params: {},
                input: { contactId: "c1", reason: REASON },
                tools: [{ id: TOOL.contactUpdate, args: { doNotContact: { reason: REASON } }, answer: refused("contact_missing") }],
                failure: { kind: "cannot", why: "nivo.tool.contact.update refused: contact_missing" },
            },
        ],
    })
