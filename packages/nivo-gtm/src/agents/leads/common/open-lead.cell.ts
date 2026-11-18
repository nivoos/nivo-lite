import { z } from "zod"
import type { ContactConversationGet, Node, NodeReach, NivoContactId } from "@starci/nivoos-sdk"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { leadCodeOf } from "./lead-code.ts"
import { LeadRef } from "./find-lead.cell.ts"
import { assertContactId } from "./typed-ref.ts"

export const OpenLeadInput = z.strictObject({
    ref: z.string().min(1).max(200),
    name: z.string().max(120),
    source: z.string().max(500),
    note: z.string().max(500),
})
/** Who owns a new lead until a person takes it over (an agent or a member id). */
export const OpenLeadSettings = z.strictObject({ owner: z.string().max(80).default("nivo-gtm.leads") })

type In = z.infer<typeof OpenLeadInput>
type Out = z.infer<typeof LeadRef>
type Settings = z.infer<typeof OpenLeadSettings>

/** The part of a contact conversation a new lead takes: the id of its contact. */
type ConversationContact = { readonly contactId: string }
/** The `contact` field a new lead is created with, when there is one. */
type LeadContact = { readonly contact?: NivoContactId }

/** The `contact` value of a new lead: the contact of the conversation the run works in, or nothing when the run has no conversation. */
const contactOf = (conversation: ConversationContact | null): LeadContact => {
    if (conversation === null) return {}
    assertContactId(conversation.contactId)
    return { contact: conversation.contactId }
}

/**
 * Opens a lead at stage `new`: one act, `object.create` of `gtm.lead` with the code the address gives, the source (the channel or the post it came from), the owner, the first next
 * action (answer them now) and, when the run works in a conversation, the contact. A refusal (a code that exists already, a value that does not fit) is thrown.
 */
export class OpenLead implements Node<typeof OpenLeadInput, typeof LeadRef, typeof OpenLeadSettings> {
    readonly key = keyOf("leads-open-lead")
    readonly version = 3
    readonly title = { vi: "Mở khách tiềm năng", en: "Open a lead" }
    readonly input = OpenLeadInput
    readonly output = LeadRef
    readonly settings = OpenLeadSettings
    readonly reads = ["contact_conversation.get"]
    readonly mutation = "object.create"

    run(input: In, reach: NodeReach<Settings>): Out {
        const code = leadCodeOf(input.ref)
        const { conversation } = reach.call<ContactConversationGet>("contact_conversation.get", {}).result
        const { result, error } = reach.objects(Lead).create({
            code,
            stage: "new",
            source: input.source.slice(0, 60),
            owner: reach.settings.owner,
            nextAction: "Trả lời khách",
            nextAt: reach.facts.at,
            ...(input.name === "" ? {} : { name: input.name }),
            ...(input.note === "" ? {} : { evidence: input.note }),
            ...contactOf(conversation),
        })
        if (error) throw error
        return { found: true, leadId: result.id, code, stage: "new", doNotContact: false, nextAction: "Trả lời khách" }
    }
}
