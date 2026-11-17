import { z } from "zod"
import type { NivoRef, Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { Publication } from "../../../objects/publication.object.ts"
import { keyOf } from "../../../package-key.ts"
import { addHours, clip } from "../common/helpers.ts"
import { CardParts, Slot } from "../common/social.shapes.ts"

export const FileSlotsInput = z.strictObject({ instant: z.string().min(10), slots: z.array(Slot).max(40) })
const Filed = z.strictObject({ id: z.string(), contentCode: z.string(), channel: z.string(), at: z.string() })
export const FileSlotsOutput = z.strictObject({
    weekCode: z.string().max(40),
    filed: z.array(Filed).max(40),
    cardText: CardParts.shape.cardText,
    choices: CardParts.shape.choices,
    nudgeText: z.string().min(1).max(500),
    reviewBy: z.string(),
    secondReviewBy: z.string(),
})
/** How long a person has to approve the week before the agent nudges, and again before it parks. */
export const FileSlotsSettings = z.strictObject({ reviewHours: z.number().int().min(1).max(240).default(24) })

type In = z.infer<typeof FileSlotsInput>
type Out = z.infer<typeof FileSlotsOutput>
type Settings = z.infer<typeof FileSlotsSettings>

const SOCIAL = "nivo-gtm.social"

/**
 * `nivo-gtm.social-file-slots` (Ghi lịch tuần): one act, `object.create` of one `gtm.publication` per slot (status `planned`, owner the Social agent, next action "Duyệt lịch tuần" due at the review time). The card of the week
 * (Duyệt cả tuần / Sửa) and its two review times are made here, from the slots.
 */
export class SocialFileSlots implements Node<typeof FileSlotsInput, typeof FileSlotsOutput, typeof FileSlotsSettings> {
    readonly key = keyOf("social-file-slots")
    readonly version = 1
    readonly title = { vi: "Ghi lịch tuần", en: "File the week's slots" }
    readonly input = FileSlotsInput
    readonly output = FileSlotsOutput
    readonly settings = FileSlotsSettings
    readonly reads = []
    readonly mutation = "object.create"

    run(input: In, reach: NodeReach<Settings>): Out {
        const reviewBy = addHours(input.instant, reach.settings.reviewHours)
        const filed: Array<z.infer<typeof Filed>> = []
        const lines: Array<string> = []
        for (const slot of input.slots) {
            const { result, error } = reach.objects(Publication).create({
                content: slot.contentId as NivoRef<Content>,
                channel: slot.channel,
                status: "planned",
                at: slot.at,
                owner: SOCIAL,
                nextAction: "Duyệt lịch tuần",
                nextAt: reviewBy,
            })
            if (error) throw error
            filed.push({ id: String(result.id), contentCode: slot.contentCode, channel: slot.channel, at: slot.at })
            lines.push(`${slot.at.slice(0, 16).replace("T", " ")} UTC · ${slot.channel} · ${slot.contentCode}: ${slot.why}`)
        }
        const weekCode = `W${input.instant.slice(0, 10).replace(/-/gu, "")}`
        return {
            weekCode,
            filed,
            cardText: clip(`Lịch đăng tuần tới (${weekCode}): ${String(filed.length)} bài.\n\n${lines.join("\n")}\n\nDuyệt cả tuần để các bài được đăng đúng giờ (mỗi bài vẫn cần duyệt khi gửi ra ngoài).`, 3000),
            choices: [
                { value: "week-approve", label: "Duyệt cả tuần" },
                { value: "week-revise", label: "Sửa" },
            ],
            nudgeText: `Lịch tuần ${weekCode} vẫn đang chờ duyệt.`,
            reviewBy,
            secondReviewBy: addHours(reviewBy, reach.settings.reviewHours),
        }
    }
}
