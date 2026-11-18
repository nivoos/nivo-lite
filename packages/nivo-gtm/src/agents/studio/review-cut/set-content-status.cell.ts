import { refOf } from "../../../common/helpers/refs.ts"
import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import { clip } from "../common/helpers.ts"

export const SetContentStatusInput = z.strictObject({
    objectId: z.string().min(1).max(100),
    status: z.enum(["approved", "producing"]),
    nextAction: z.string().min(1).max(2000),
    evidence: z.string().max(2000),
})
export const SetContentStatusOutput = z.strictObject({
    code: z.string().max(40),
    status: z.enum(["approved", "producing"]),
})

type In = z.infer<typeof SetContentStatusInput>
type Out = z.infer<typeof SetContentStatusOutput>

/**
 * `nivo-gtm.studio-set-content-status` (Đổi trạng thái nội dung): one act, `object.update` of the content item after a cut was decided: `approved` (the cut link is the evidence, the next action is to plan its post) or `producing`
 * (sent back: the next action is what to fix). The status write is what `produce` waits on for the verdict.
 */
export class StudioSetContentStatus implements Node<typeof SetContentStatusInput, typeof SetContentStatusOutput> {
    readonly key = keyOf("studio-set-content-status")
    readonly version = 1
    readonly title = { vi: "Đổi trạng thái nội dung", en: "Set the content status" }
    readonly input = SetContentStatusInput
    readonly output = SetContentStatusOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        const got = reach.objects(Content).get(refOf<Content>(input.objectId))
        if (got.error) throw got.error
        const { error } = reach.objects(Content).update({
            id: got.result.id,
            version: got.result.version,
            values: {
                status: input.status,
                nextAction: clip(input.nextAction, 300),
                nextAt: null,
                ...(input.evidence === "" ? {} : { evidence: clip(input.evidence, 2000) }),
            },
        })
        if (error) throw error
        return { code: got.result.values.code, status: input.status }
    }
}
