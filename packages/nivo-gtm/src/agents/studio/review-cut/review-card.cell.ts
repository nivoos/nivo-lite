import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { addHours, clip } from "../common/helpers.ts"
import { CardParts } from "../common/studio.shapes.ts"
import { CheckCutOutput } from "./check-cut.cell.ts"
import { ReadCutOutput } from "./read-cut.cell.ts"

export const ReviewCardInput = z.strictObject({ cut: ReadCutOutput, check: CheckCutOutput })
export const ReviewCardOutput = z.strictObject({
    reviewBy: z.string().max(40),
    secondReviewBy: z.string().max(40),
    cardText: CardParts.shape.cardText,
    nudgeText: CardParts.shape.cardText,
    choices: CardParts.shape.choices,
})
/** How long a person has to review a cut: the first deadline is one period, the nudge gives a second. */
export const ReviewCardSettings = z.strictObject({ reviewHours: z.number().int().min(1).max(240).default(48) })

type In = z.infer<typeof ReviewCardInput>
type Out = z.infer<typeof ReviewCardOutput>
type Settings = z.infer<typeof ReviewCardSettings>

const MARK = { ok: "[ok]", fail: "[không đạt]", unknown: "[cần xem]" }

/** `nivo-gtm.studio-review-card` (Làm thẻ duyệt bản dựng): a decision node. It builds the review card (the link, the checklist, Duyệt and Sửa) and the two deadlines from the cut and its checklist. */
export class StudioReviewCard implements Node<
    typeof ReviewCardInput,
    typeof ReviewCardOutput,
    typeof ReviewCardSettings
> {
    readonly key = keyOf("studio-review-card")
    readonly version = 1
    readonly title = { vi: "Làm thẻ duyệt bản dựng", en: "Build the cut review card" }
    readonly input = ReviewCardInput
    readonly output = ReviewCardOutput
    readonly settings = ReviewCardSettings
    readonly reads = []

    run(input: In, reach: NodeReach<Settings>): Out {
        const at = reach.facts.at
        const lines = input.check.items
            .map((item) => {
                const note = item.note === "" ? "" : ` - ${item.note}`
                return `${MARK[item.status]} ${item.check}${note}`
            })
            .join("\n")
        const body = `Duyệt bản dựng ${input.cut.code}: ${input.cut.title} (bản ${String(input.cut.version)})\nLiên kết: ${input.cut.fileLink}\n\n${input.check.summary}\n\n${lines}`
        return {
            reviewBy: addHours(at, reach.settings.reviewHours),
            secondReviewBy: addHours(at, reach.settings.reviewHours * 2),
            cardText: clip(body, 3000),
            nudgeText: `Bản dựng ${input.cut.code} đang chờ duyệt: ${input.cut.fileLink}`,
            choices: [
                { value: "cut-approve", label: "Duyệt" },
                { value: "cut-fix", label: "Sửa" },
            ],
        }
    }
}
