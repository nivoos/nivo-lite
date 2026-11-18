import { refOf } from "../../../common/helpers/refs.ts"
import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { VideoCut } from "../../../objects/video-cut.object.ts"
import { keyOf } from "../../../package-key.ts"
import type { BrainSearch } from "../common/callees.ts"
import { clip, textOf } from "../common/helpers.ts"

export const ReadCutInput = z.strictObject({ contentId: z.string().min(1).max(100), cutId: z.string().min(1).max(100) })
const Passage = z.strictObject({ query: z.string().max(120), text: z.string().max(1200) })
export const ReadCutOutput = z.strictObject({
    contentId: z.string().max(100),
    cutId: z.string().max(100),
    version: z.number().int(),
    code: z.string().max(40),
    title: z.string().max(200),
    fileLink: z.string().max(500),
    /** The approved script as the cut is checked against: the hook, the call to action, the planned length and the caption. */
    hook: z.string().max(400),
    cta: z.string().max(300),
    seconds: z.number().int(),
    caption: z.string().max(3000),
    brain: z.array(Passage).max(6),
})
export const ReadCutSettings = z.strictObject({ brainHits: z.number().int().min(1).max(8).default(4) })

type In = z.infer<typeof ReadCutInput>
type Out = z.infer<typeof ReadCutOutput>
type Settings = z.infer<typeof ReadCutSettings>

/** The words a price must come from: the public price document. */
const QUESTION = "public plans and prices, what a video may say about price"

/** `nivo-gtm.studio-read-cut` (Đọc bản dựng): a decision node. It reads the item with its approved script, the cut with its link, and the public price document, so the check compares the cut with what was approved. */
export class StudioReadCut implements Node<typeof ReadCutInput, typeof ReadCutOutput, typeof ReadCutSettings> {
    readonly key = keyOf("studio-read-cut")
    readonly version = 1
    readonly title = { vi: "Đọc bản dựng", en: "Read the cut" }
    readonly input = ReadCutInput
    readonly output = ReadCutOutput
    readonly settings = ReadCutSettings
    readonly reads = ["object.get", "brain.search"]

    run(input: In, reach: NodeReach<Settings>): Out {
        const content = reach.objects(Content).get(refOf<Content>(input.contentId))
        if (content.error) throw content.error
        const cut = reach.objects(VideoCut).get(refOf<VideoCut>(input.cutId))
        if (cut.error) throw cut.error
        const { result } = reach.call<BrainSearch>("brain.search", { query: QUESTION, limit: reach.settings.brainHits })
        const brain = result.hits.map((hit) => ({
            query: clip(QUESTION, 120),
            text: clip(JSON.stringify(hit.passage ?? hit.truth), 1200),
        }))
        const script = content.result.values.script ?? {}
        return {
            contentId: content.result.id,
            cutId: cut.result.id,
            version: cut.result.values.version,
            code: content.result.values.code,
            title: content.result.values.title,
            fileLink: cut.result.values.fileLink,
            hook: clip(textOf(script["hook"]), 400),
            cta: clip(textOf(script["cta"]), 300),
            seconds: Number(script["seconds"] ?? 0),
            caption: clip(content.result.values.caption ?? "", 3000),
            brain,
        }
    }
}
