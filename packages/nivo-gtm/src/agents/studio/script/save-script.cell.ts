import { refOf } from "../../../common/helpers/refs.ts"
import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import { addHours, clip } from "../common/helpers.ts"
import { CardParts, ScriptDraft } from "../common/studio.shapes.ts"

export const SaveScriptInput = z.strictObject({ objectId: z.string().min(1).max(100), draft: ScriptDraft })
export const SaveScriptOutput = z.strictObject({
    code: z.string().max(40),
    reviewBy: z.string().max(40),
    secondReviewBy: z.string().max(40),
    cardText: CardParts.shape.cardText,
    nudgeText: CardParts.shape.cardText,
    choices: CardParts.shape.choices,
})
/** How long a person has to review a script: the first deadline is one period, the nudge gives a second. */
export const SaveScriptSettings = z.strictObject({ reviewHours: z.number().int().min(1).max(240).default(48) })

type In = z.infer<typeof SaveScriptInput>
type Out = z.infer<typeof SaveScriptOutput>
type Settings = z.infer<typeof SaveScriptSettings>

/**
 * `nivo-gtm.studio-save-script` (Lưu kịch bản): one act, `object.update` of the content item: the script document, the caption, the revision count, the status `script_review` and the next action "Duyệt kịch bản" due in
 * `reviewHours`. It also makes the review card (the hook, the beats, the call to action) and its two choices, so the next step only posts them.
 */
export class StudioSaveScript implements Node<
    typeof SaveScriptInput,
    typeof SaveScriptOutput,
    typeof SaveScriptSettings
> {
    readonly key = keyOf("studio-save-script")
    readonly version = 1
    readonly title = { vi: "Lưu kịch bản", en: "Save the script" }
    readonly input = SaveScriptInput
    readonly output = SaveScriptOutput
    readonly settings = SaveScriptSettings
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach<Settings>): Out {
        const got = reach.objects(Content).get(refOf<Content>(input.objectId))
        if (got.error) throw got.error
        const at = reach.facts.at
        const reviewBy = addHours(at, reach.settings.reviewHours)
        const secondReviewBy = addHours(at, reach.settings.reviewHours * 2)
        const draft = input.draft
        const { error } = reach.objects(Content).update({
            id: got.result.id,
            version: got.result.version,
            values: {
                status: "script_review",
                script: {
                    hook: draft.hook,
                    beats: draft.beats,
                    broll: draft.broll,
                    cta: draft.cta,
                    seconds: draft.seconds,
                    revision: draft.revision,
                },
                caption: clip(draft.caption, 3000),
                revisions: draft.revision,
                nextAction: "Duyệt kịch bản",
                nextAt: reviewBy,
            },
        })
        if (error) throw error
        const code = got.result.values.code
        const beats = draft.beats
            .map((beat, index) => `${String(index + 1)}. [${beat.at}] ${beat.onScreen} | ${beat.voiceOver}`)
            .join("\n")
        const body = `Kịch bản ${code}: ${got.result.values.title} (bản ${String(draft.revision + 1)}, ${String(draft.seconds)} giây)\n\nMở đầu: ${draft.hook}\n\n${beats}\n\nKêu gọi: ${draft.cta}\n\nCaption: ${draft.caption}`
        return {
            code,
            reviewBy,
            secondReviewBy,
            cardText: clip(body, 3000),
            nudgeText: `Kịch bản ${code} đang chờ duyệt. Duyệt để chuyển sang khâu quay dựng, hoặc bấm Sửa để viết lại.`,
            choices: [
                { value: "script-approve", label: "Duyệt" },
                { value: "script-revise", label: "Sửa" },
            ],
        }
    }
}
