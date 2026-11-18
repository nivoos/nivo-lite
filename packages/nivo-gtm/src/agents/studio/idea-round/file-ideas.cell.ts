import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import { addHours, clip, compactDay } from "../common/helpers.ts"
import { CardParts, Idea } from "../common/studio.shapes.ts"

export const FileIdeasInput = z.strictObject({
    instant: z.string().min(10).max(40),
    ideas: z.array(Idea).min(1).max(5),
})
export const FileIdeasOutput = z.strictObject({
    codes: z.array(z.string().max(40)).max(5),
    cardText: CardParts.shape.cardText,
    choices: CardParts.shape.choices,
})
/** How long an idea may wait for a person to choose it before its `nextAt` is due. */
export const FileIdeasSettings = z.strictObject({ pickHours: z.number().int().min(1).max(240).default(48) })

type In = z.infer<typeof FileIdeasInput>
type Out = z.infer<typeof FileIdeasOutput>
type Settings = z.infer<typeof FileIdeasSettings>

/** The owner an idea has until a person picks it: the Studio agent itself. */
const STUDIO = "nivo-gtm.studio"

/**
 * `nivo-gtm.studio-file-ideas` (Ghi ý tưởng): one act, `object.create` of one `gtm.content` per idea (status `idea`, owner the Studio agent, the next action "Chọn ý tưởng" due in `pickHours`). A code is
 * `CT-<yyyymmdd>-<n>`, so a rerun of the round finds its own rows (`OBJECTS_VALUE_TAKEN`) and files nothing twice. The card text and its choices (Chọn per idea, Bỏ cả tuần) are made here, from the codes.
 */
export class StudioFileIdeas implements Node<typeof FileIdeasInput, typeof FileIdeasOutput, typeof FileIdeasSettings> {
    readonly key = keyOf("studio-file-ideas")
    readonly version = 1
    readonly title = { vi: "Ghi ý tưởng vào danh sách", en: "File the ideas" }
    readonly input = FileIdeasInput
    readonly output = FileIdeasOutput
    readonly settings = FileIdeasSettings
    readonly reads = []
    readonly mutation = "object.create"

    run(input: In, reach: NodeReach<Settings>): Out {
        const day = compactDay(input.instant)
        const nextAt = addHours(input.instant, reach.settings.pickHours)
        const codes: Array<string> = []
        const lines: Array<string> = []
        const choices: Array<{ value: string; label: string }> = []
        input.ideas.forEach((idea, at) => {
            const code = `CT-${day}-${String(at + 1)}`
            const { error } = reach.objects(Content).create({
                code,
                kind: idea.format,
                title: idea.title,
                status: "idea",
                pillar: idea.pillar,
                hook: idea.hook,
                owner: STUDIO,
                nextAction: "Chọn ý tưởng",
                nextAt,
            })
            // a rerun of the same round: the row is there already, nothing is filed twice
            if (error && error.code !== "OBJECTS_VALUE_TAKEN") throw error
            codes.push(code)
            lines.push(
                `${String(at + 1)}. [${idea.format === "video" ? "Video" : "Bài viết"}] ${idea.title}\n   Mở đầu: ${idea.hook}\n   Góc: ${idea.angle}\n   Cho: ${idea.segment}. Vì sao bây giờ: ${idea.whyNow}`,
            )
            choices.push({ value: `idea-choose:${code}`, label: `Chọn ${String(at + 1)}` })
        })
        choices.push({ value: `idea-drop:${day}`, label: "Bỏ cả tuần" })
        return {
            codes,
            cardText: clip(
                `Ý tưởng tuần này (${day}). Chọn một ý tưởng để viết kịch bản.\n\n${lines.join("\n\n")}`,
                3000,
            ),
            choices,
        }
    }
}
