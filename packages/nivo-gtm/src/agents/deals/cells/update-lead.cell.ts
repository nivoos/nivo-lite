import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Lead, LEAD_STAGES } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"

export const UpdateLeadInput = z.strictObject({
    leadId: z.string().min(1),
    stage: z.enum(LEAD_STAGES),
    nextAction: z.string().max(300),
    evidence: z.string().max(2000),
})
export const UpdateLeadOutput = z.strictObject({ version: z.number().int() })

type In = z.infer<typeof UpdateLeadInput>
type Out = z.infer<typeof UpdateLeadOutput>

/** `nivo-gtm.update-lead` (Cập nhật khách tiềm năng): ONE act, `object.update` of the `gtm.lead`: its stage, its next action and the evidence of the move. Deals uses it to mark a lead `won`. */
export class UpdateLead implements Node<typeof UpdateLeadInput, typeof UpdateLeadOutput> {
    readonly key = keyOf("update-lead")
    readonly version = 1
    readonly title = { vi: "Cập nhật khách tiềm năng", en: "Update the lead" }
    readonly input = UpdateLeadInput
    readonly output = UpdateLeadOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        const lead = reach.objects(Lead).get(input.leadId as never)
        if (lead.error) throw lead.error
        const { result, error } = reach.objects(Lead).update({
            id: input.leadId as never,
            version: lead.result.version,
            values: { stage: input.stage, nextAction: input.nextAction, evidence: input.evidence },
        })
        if (error) throw error
        return { version: result.version }
    }
}
