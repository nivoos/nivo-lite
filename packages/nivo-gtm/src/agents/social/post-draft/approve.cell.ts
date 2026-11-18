import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { refOf } from "../common/helpers.ts"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"

export const ApproveInput = z.strictObject({ objectId: z.string().max(80).min(1), memberId: z.string().min(1).max(80) })
export const ApproveOutput = z.strictObject({ contentId: z.string().max(80), code: z.string().max(40) })

type In = z.infer<typeof ApproveInput>
type Out = z.infer<typeof ApproveOutput>

/**
 * `nivo-gtm.social-approve-post` (Duyệt bài đăng): one act, `object.update` of the content item to `approved`, its owner the person who approved it, the next action "Lên lịch đăng". The approval of the text is the person's;
 * publishing is approved again at the send step.
 */
export class SocialApprovePost implements Node<typeof ApproveInput, typeof ApproveOutput> {
    readonly key = keyOf("social-approve-post")
    readonly version = 1
    readonly title = { vi: "Duyệt bài đăng", en: "Approve the post" }
    readonly input = ApproveInput
    readonly output = ApproveOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        const got = reach.objects(Content).get(refOf<Content>(input.objectId))
        if (got.error) throw got.error
        const { error } = reach.objects(Content).update({
            id: got.result.id,
            version: got.result.version,
            values: { status: "approved", owner: input.memberId, nextAction: "Lên lịch đăng", nextAt: null },
        })
        if (error) throw error
        return { contentId: input.objectId, code: got.result.values.code }
    }
}
