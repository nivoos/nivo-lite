import { z } from "zod"
import type { NivoRef, Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import { addHours, clip } from "../common/helpers.ts"
import { CardParts, PostDraft } from "../common/social.shapes.ts"

export const SaveInput = z.strictObject({ objectId: z.string().min(1), draft: PostDraft })
export const SaveOutput = z.strictObject({
    code: z.string().max(40),
    cardText: CardParts.shape.cardText,
    choices: CardParts.shape.choices,
    nudgeText: z.string().min(1).max(500),
    reviewBy: z.string(),
    secondReviewBy: z.string(),
})
/** How long a person has to review a post before the agent nudges, and again before the run ends `no_review`. */
export const SaveSettings = z.strictObject({ reviewHours: z.number().int().min(1).max(240).default(24) })

type In = z.infer<typeof SaveInput>
type Out = z.infer<typeof SaveOutput>
type Settings = z.infer<typeof SaveSettings>

/**
 * `nivo-gtm.social-save-draft` (Lưu bản nháp bài đăng): one act, `object.update` of the content item: the caption with its hashtags, the draft as the document, the revision count, status `script_review` (the item is under
 * review), next action "Duyệt bài đăng" due at the review time. The card (Duyệt / Sửa) is made here.
 */
export class SocialSaveDraft implements Node<typeof SaveInput, typeof SaveOutput, typeof SaveSettings> {
    readonly key = keyOf("social-save-draft")
    readonly version = 2
    readonly title = { vi: "Lưu bản nháp bài đăng", en: "Save the post draft" }
    readonly input = SaveInput
    readonly output = SaveOutput
    readonly settings = SaveSettings
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Content).get(input.objectId as NivoRef<Content>)
        if (got.error) throw got.error
        const reviewBy = addHours(reach.facts.at, reach.settings.reviewHours)
        const caption = clip(`${input.draft.caption}\n\n${input.draft.hashtags.join(" ")}`.trim(), 3000)
        const { error } = reach.objects(Content).update({
            id: got.result.id,
            version: got.result.version,
            values: {
                status: "script_review",
                caption,
                script: { kind: "post", caption: input.draft.caption, hashtags: input.draft.hashtags, imageText: input.draft.imageText },
                revisions: input.draft.revision,
                nextAction: "Duyệt bài đăng",
                nextAt: reviewBy,
            },
        })
        if (error) throw error
        const code = got.result.values.code
        return {
            code,
            cardText: clip(`Bài đăng ${code}: ${got.result.values.title}\n\n${caption}\n\nChữ trên ảnh: ${input.draft.imageText}`, 3000),
            choices: [
                { value: "post-approve", label: "Duyệt" },
                { value: "post-revise", label: "Sửa" },
            ],
            nudgeText: `Bài đăng ${code} vẫn đang chờ duyệt.`,
            reviewBy,
            secondReviewBy: addHours(reviewBy, reach.settings.reviewHours),
        }
    }
}
