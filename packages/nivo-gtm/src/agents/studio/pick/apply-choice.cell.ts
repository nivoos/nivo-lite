import { z } from "zod"
import type { Node, NodeReach, NivoObjectsReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"

export const ApplyChoiceInput = z.strictObject({
    choice: z.string().min(1).max(100),
    memberId: z.string().min(1).max(80),
})
export const ApplyChoiceOutput = z.strictObject({
    decision: z.enum(["chosen", "dropped", "ignored"]),
    codes: z.array(z.string().max(40)).max(10),
    kind: z.string().max(20),
})
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
/** The answer for a choice that is not an idea choice: nothing changes. */
const IGNORED: Out = { decision: "ignored", codes: [], kind: "" }

type Contents = NivoObjectsReach<Content>
type Found = ReturnType<Contents["query"]>
type Items = NonNullable<Found["result"]>["items"]

/** Moves the idea a person picked (already read by its code) to `chosen`, a video to the Studio agent and a post to the person who chose it. */
function choose(input: In, code: string, items: Items, contents: Contents, settings: Settings): Out {
    const item = items.at(0)
    if (item?.values.status !== "idea") return IGNORED
    const video = item.values.kind === "video"
    const { error } = contents.update({
        id: item.id,
        version: item.version,
        values: {
            status: "chosen",
            owner: video ? STUDIO : input.memberId,
            nextAction: video ? settings.videoNext : settings.postNext,
        },
    })
    if (error) throw error
    return { decision: "chosen", codes: [code], kind: item.values.kind }
}

/** Moves every idea still open on the card of one day (already read) to `dropped`. */
function drop(items: Items, contents: Contents): Out {
    const codes: Array<string> = []
    for (const item of items) {
        const { error } = contents.update({
            id: item.id,
            version: item.version,
            values: { status: "dropped", nextAction: null },
        })
        if (error) throw error
        codes.push(item.values.code)
    }
    return { decision: "dropped", codes, kind: "" }
}

/**
 * `nivo-gtm.studio-apply-choice` (Áp dụng lựa chọn ý tưởng): one act, `object.update` of what the person decided on the ideas card: Chọn moves that idea to `chosen` (a video is owned by the Studio agent, a post by the person who
 * chose it), Bỏ cả tuần moves every still-open idea of that day to `dropped`. A choice of another card (not an idea choice) is `ignored` and changes nothing. The status write is what opens the `script` or `post-draft` workflow.
 */
export class StudioApplyChoice implements Node<
    typeof ApplyChoiceInput,
    typeof ApplyChoiceOutput,
    typeof ApplyChoiceSettings
> {
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
            return choose(input, code, found.result.items, reach.objects(Content), reach.settings)
        }
        if (input.choice.startsWith(DROP)) {
            const day = input.choice.slice(DROP.length)
            const open = reach
                .objects(Content)
                .query({ where: { status: "idea", code: { contains: `CT-${day}-` } }, limit: 10 })
            if (open.error) throw open.error
            return drop(open.result.items, reach.objects(Content))
        }
        return IGNORED
    }
}
