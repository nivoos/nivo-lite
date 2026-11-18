import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Lead } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { leadCodeOf } from "./lead-code.ts"

export const FindLeadInput = z.strictObject({ ref: z.string().min(1).max(200) })
/** A lead as the workflows route on it: whether it exists, its object id and code, where it stands, whether it may be written to. `leadId` is empty when there is none. */
export const LeadRef = z.strictObject({
    found: z.boolean(),
    leadId: z.string().max(80),
    code: z.string().max(60),
    stage: z.string().max(30),
    doNotContact: z.boolean(),
    nextAction: z.string().max(300),
})

type In = z.infer<typeof FindLeadInput>
type Out = z.infer<typeof LeadRef>

/** Looks a lead up by its address (`ref`: a Telegram id, or `<channel>:<id>`): the lead code is unique and indexed. A decision node: it reads only. */
export class FindLead implements Node<typeof FindLeadInput, typeof LeadRef> {
    readonly key = keyOf("leads-find-lead")
    readonly version = 3
    readonly title = { vi: "Tìm khách tiềm năng", en: "Find the lead" }
    readonly input = FindLeadInput
    readonly output = LeadRef
    readonly reads = ["object.query"]

    run(input: In, reach: NodeReach): Out {
        const code = leadCodeOf(input.ref)
        const { result, error } = reach.objects(Lead).query({ where: { code }, limit: 1 })
        if (error) throw error
        const lead = result.items.at(0)
        if (lead === undefined)
            return { found: false, leadId: "", code, stage: "", doNotContact: false, nextAction: "" }
        return {
            found: true,
            leadId: lead.id,
            code,
            stage: lead.values.stage,
            doNotContact: lead.values.doNotContact === true,
            nextAction: lead.values.nextAction ?? "",
        }
    }
}
