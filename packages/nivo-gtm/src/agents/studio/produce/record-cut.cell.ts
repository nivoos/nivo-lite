import { refOf } from "../../../common/helpers/refs.ts"
import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { VideoCut } from "../../../objects/video-cut.object.ts"
import { keyOf } from "../../../package-key.ts"
import { addHours, clip } from "../common/helpers.ts"

export const RecordCutInput = z.strictObject({ objectId: z.string().min(1).max(100), link: z.string().max(2000) })
export const RecordCutOutput = z.strictObject({
    cutId: z.string().max(100),
    contentId: z.string().max(100),
    version: z.number().int().min(1),
    fileLink: z.string().max(500),
})
/** How long a person has to review a cut: it is the next action's due time on the cut. */
export const RecordCutSettings = z.strictObject({ reviewHours: z.number().int().min(1).max(240).default(48) })

type In = z.infer<typeof RecordCutInput>
type Out = z.infer<typeof RecordCutOutput>
type Settings = z.infer<typeof RecordCutSettings>

const STUDIO = "nivo-gtm.studio"

/**
 * `nivo-gtm.studio-record-cut` (Ghi bản dựng): one act, `object.create` of the next `gtm.video-cut` of the item (version = the cuts it has + 1, verdict `pending`). The link is the one the person put in the evidence
 * when they set the item to `cut_ready` (an https link); without one the cut points at the shoot folder. The cut's next action is "Duyệt bản dựng".
 */
export class StudioRecordCut implements Node<typeof RecordCutInput, typeof RecordCutOutput, typeof RecordCutSettings> {
    readonly key = keyOf("studio-record-cut")
    readonly version = 1
    readonly title = { vi: "Ghi bản dựng", en: "Record the cut" }
    readonly input = RecordCutInput
    readonly output = RecordCutOutput
    readonly settings = RecordCutSettings
    readonly reads = ["object.get", "object.query"]
    readonly mutation = "object.create"

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Content).get(refOf<Content>(input.objectId))
        if (got.error) throw got.error
        const cuts = reach.objects(VideoCut).query({ sort: { by: "createdAt", direction: "desc" }, limit: 200 })
        if (cuts.error) throw cuts.error
        const mine = cuts.result.items.filter((cut) => cut.values.content === got.result.id)
        const version = mine.length + 1
        const text = input.link.trim()
        const fileLink = clip(text.startsWith("http") ? text : (got.result.values.driveFolder ?? text), 500)
        const made = reach.objects(VideoCut).create({
            content: got.result.id,
            version,
            fileLink: fileLink === "" ? "(chưa có liên kết)" : fileLink,
            verdict: "pending",
            owner: STUDIO,
            nextAction: "Duyệt bản dựng",
            nextAt: addHours(reach.facts.at, reach.settings.reviewHours),
            evidence: clip(`Bản dựng ${String(version)} của ${got.result.values.code}`, 2000),
        })
        if (made.error) throw made.error
        return { cutId: made.result.id, contentId: got.result.id, version, fileLink }
    }
}
