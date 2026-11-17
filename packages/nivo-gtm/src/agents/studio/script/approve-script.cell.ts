import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { NivoRef } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"

export const ApproveScriptInput = z.strictObject({ objectId: z.string().min(1), memberId: z.string().min(1).max(80) })
export const ApproveScriptOutput = z.strictObject({ code: z.string().max(40), approvedBy: z.string().max(80) })

type In = z.infer<typeof ApproveScriptInput>
type Out = z.infer<typeof ApproveScriptOutput>

/**
 * `nivo-gtm.studio-approve-script` (Duyệt kịch bản): one act, `object.update` of the content item to `script_ok` with the next action "Quay và dựng". The status write is what opens the `produce` workflow. The person who pressed
 * Duyệt is kept in the evidence line, so the decision has a name.
 */
export class StudioApproveScript implements Node<typeof ApproveScriptInput, typeof ApproveScriptOutput> {
    readonly key = keyOf("studio-approve-script")
    readonly version = 1
    readonly title = { vi: "Duyệt kịch bản", en: "Approve the script" }
    readonly input = ApproveScriptInput
    readonly output = ApproveScriptOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        const got = reach.objects(Content).get(input.objectId as NivoRef<Content>)
        if (got.error) throw got.error
        const { error } = reach.objects(Content).update({
            id: got.result.id,
            version: got.result.version,
            values: { status: "script_ok", nextAction: "Quay và dựng", nextAt: null, evidence: `Kịch bản được duyệt bởi ${input.memberId} lúc ${reach.facts.at}` },
        })
        if (error) throw error
        return { code: got.result.values.code, approvedBy: input.memberId }
    }
}
