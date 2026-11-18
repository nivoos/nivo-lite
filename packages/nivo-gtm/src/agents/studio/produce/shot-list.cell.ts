import { refOf } from "../../../common/helpers/refs.ts"
import { z } from "zod"
import type { JsonValue, ModelGenerate, Node, NodeReach } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import { STUDIO_POLICY } from "../common/studio.policy.ts"

export const ShotListInput = z.strictObject({ objectId: z.string().min(1).max(100) })
const Shot = z.strictObject({
    n: z.number().int().min(1).max(40),
    scene: z.string().max(200),
    camera: z.string().max(200),
    line: z.string().max(400),
})
export const ShotListOutput = z.strictObject({
    shots: z.array(Shot).min(1).max(20),
    teleprompter: z.string().max(3000),
    props: z.array(z.string().max(120)).max(12),
})

type In = z.infer<typeof ShotListInput>
type Out = z.infer<typeof ShotListOutput>

const GOAL =
    "Turn the approved `script` into a shot list a person can follow with a phone: `shots` in order (`n`, `scene` what is in the frame, `camera` how to film it, `line` what is said or shown), `teleprompter` (the full voice-over " +
    "as one text to read) and `props` (what to prepare). Keep every number and fact of the script; add nothing the script does not say."

/** Whether a loose object field is JSON all the way down (null, text, number, flag, list or record of those), so it can go to the model as data. */
function isJson(value: unknown): boolean {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true
    if (Array.isArray(value)) return value.every((item) => isJson(item))
    return typeof value === "object" && Object.values(value).every((item) => isJson(item))
}

/** The JSON a loose object field holds, or null when it is not JSON all the way down. */
function jsonOf(value: unknown): JsonValue {
    return [value].find((item): item is JsonValue => isJson(item)) ?? null
}

/**
 * `nivo-gtm.studio-shot-list` (Danh sách cảnh quay): ONE generation. It reads the approved script of the item and writes the shot list and the teleprompter text. The list
 * lives on the card and in the run (the shoot-folder document is the Drive seam, "chờ kết nối").
 */
export class StudioShotList implements Node<typeof ShotListInput, typeof ShotListOutput> {
    readonly key = keyOf("studio-shot-list")
    readonly version = 1
    readonly title = { vi: "Danh sách cảnh quay", en: "Shot list" }
    readonly input = ShotListInput
    readonly output = ShotListOutput
    readonly reads = ["object.get"]
    readonly mutation = "model.generate"
    readonly model = { model: "sonnet-5-5", effort: "balanced" } as const

    run(input: In, reach: NodeReach): Out {
        const got = reach.objects(Content).get(refOf<Content>(input.objectId))
        if (got.error) throw got.error
        const { result, error } = reach.call<ModelGenerate<Out>>("model.generate", {
            prompt: `${STUDIO_POLICY}\n\n${GOAL}`,
            data: {
                title: got.result.values.title,
                script: jsonOf(got.result.values.script ?? {}),
                caption: got.result.values.caption ?? "",
            },
        })
        if (error) throw error
        return result.value
    }
}
