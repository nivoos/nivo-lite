import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"

export const ApplyChoiceInput = z.strictObject({ choice: z.string().min(1).max(100), memberId: z.string().min(1).max(80) })
export const ApplyChoiceOutput = z.strictObject({ decision: z.enum(["chosen", "dropped", "ignored"]), codes: z.array(z.string().max(40)).max(10), kind: z.string().max(20) })
/** The next steps an idea gets once a person picks it, as words on the item (per-customer wording). */
export const ApplyChoiceSettings = z.strictObject({
    videoNext: z.string().min(1).max(300).default("Viết kịch bản"),
    postNext: z.string().min(1).max(300).default("Soạn bài đăng"),
})

type In = z.infer<typeof ApplyChoiceInput>
type Out = z.infer<typeof ApplyChoiceOutput>
type Settings = z.infer<typeof ApplyChoiceSettings>

const CHOOSE = "idea-choose:"
const DROP = "idea-drop:"
const STUDIO = "nivo-gtm.studio"

/**
 * `nivo-gtm.studio-apply-choice` (Áp dụng lựa chọn ý tưởng): one act, `object.update` of what the person decided on the ideas card: Chọn moves that idea to `chosen` (a video is owned by the Studio agent, a post by the person who
 * chose it), Bỏ cả tuần moves every still-open idea of that day to `dropped`. A choice of another card (not an idea choice) is `ignored` and changes nothing. The status write is what opens the `script` or `post-draft` workflow.
 */
export class StudioApplyChoice implements Node<typeof ApplyChoiceInput, typeof ApplyChoiceOutput, typeof ApplyChoiceSettings> {
    readonly key = keyOf("studio-apply-choice")
    readonly version = 1
    readonly title = { vi: "Áp dụng lựa chọn ý tưởng", en: "Apply the idea choice" }
    readonly input = ApplyChoiceInput
    readonly output = ApplyChoiceOutput
    readonly settings = ApplyChoiceSettings
    readonly reads = ["object.query"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach<Settings>): Out {
        if (input.choice.startsWith(CHOOSE)) {
            const code = input.choice.slice(CHOOSE.length)
            const found = reach.objects(Content).query({ where: { code }, limit: 1 })
            if (found.error) throw found.error
            const [item] = found.result.items
            if (item === undefined || item.values.status !== "idea") return { decision: "ignored", codes: [], kind: "" }
            const video = item.values.kind === "video"
            const { error } = reach.objects(Content).update({
                id: item.id,
                version: item.version,
                values: { status: "chosen", owner: video ? STUDIO : input.memberId, nextAction: video ? reach.settings.videoNext : reach.settings.postNext },
            })
            if (error) throw error
            return { decision: "chosen", codes: [code], kind: item.values.kind }
        }
        if (input.choice.startsWith(DROP)) {
            const day = input.choice.slice(DROP.length)
            const open = reach.objects(Content).query({ where: { status: "idea", code: { contains: `CT-${day}-` } }, limit: 10 })
            if (open.error) throw open.error
            const codes: Array<string> = []
            for (const item of open.result.items) {
                const { error } = reach.objects(Content).update({ id: item.id, version: item.version, values: { status: "dropped", nextAction: null } })
                if (error) throw error
                codes.push(item.values.code)
            }
            return { decision: "dropped", codes, kind: "" }
        }
        return { decision: "ignored", codes: [], kind: "" }
    }
}
