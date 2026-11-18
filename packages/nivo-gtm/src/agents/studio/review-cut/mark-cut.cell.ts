import { refOf } from "../../../common/helpers/refs.ts"
import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { VideoCut } from "../../../objects/video-cut.object.ts"
import { keyOf } from "../../../package-key.ts"
import { clip } from "../common/helpers.ts"

export const MarkCutInput = z.strictObject({
    cutId: z.string().min(1).max(100),
    verdict: z.enum(["approved", "fix"]),
    memberId: z.string().min(1).max(80),
    note: z.string().max(2000),
})
export const MarkCutOutput = z.strictObject({ cutId: z.string().max(100), verdict: z.enum(["approved", "fix"]) })

type In = z.infer<typeof MarkCutInput>
type Out = z.infer<typeof MarkCutOutput>

/**
 * `nivo-gtm.studio-mark-cut` (Ghi kết luận bản dựng): one act, `object.update` of the cut: the verdict a person gave (`approved` or `fix`), who gave it and the checklist as the note. The next action of a decided cut is empty.
 */
export class StudioMarkCut implements Node<typeof MarkCutInput, typeof MarkCutOutput> {
    readonly key = keyOf("studio-mark-cut")
    readonly version = 1
    readonly title = { vi: "Ghi kết luận bản dựng", en: "Record the cut verdict" }
    readonly input = MarkCutInput
    readonly output = MarkCutOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        const got = reach.objects(VideoCut).get(refOf<VideoCut>(input.cutId))
        if (got.error) throw got.error
        const { error } = reach.objects(VideoCut).update({
            id: got.result.id,
            version: got.result.version,
            values: {
                verdict: input.verdict,
                reviewer: input.memberId,
                note: clip(input.note, 1000),
                nextAction: null,
                nextAt: null,
            },
        })
        if (error) throw error
        return { cutId: got.result.id, verdict: input.verdict }
    }
}
