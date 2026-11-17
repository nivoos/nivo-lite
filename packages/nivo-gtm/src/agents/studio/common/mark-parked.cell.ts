import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { NivoRef } from "@starci/nivoos-sdk"
import { Content } from "../../../objects/content.object.ts"
import { keyOf } from "../../../package-key.ts"
import { clip } from "./helpers.ts"

export const MarkParkedInput = z.strictObject({ objectId: z.string().min(1), why: z.string().min(1).max(300) })
export const MarkParkedOutput = z.strictObject({ code: z.string(), parked: z.literal(true) })

type In = z.infer<typeof MarkParkedInput>
type Out = z.infer<typeof MarkParkedOutput>

/**
 * `nivo-gtm.studio-mark-parked` (Đánh dấu nội dung bị dừng): the park half of the recovery rule for a content item: one act, `object.update` of its status to `parked` with `nextAction` filled, so a person
 * sees what to do and wakes it by moving the status back. The alert card is the next step (`park-alert`).
 */
export class StudioMarkParked implements Node<typeof MarkParkedInput, typeof MarkParkedOutput> {
    readonly key = keyOf("studio-mark-parked")
    readonly version = 1
    readonly title = { vi: "Đánh dấu nội dung bị dừng", en: "Mark the content parked" }
    readonly input = MarkParkedInput
    readonly output = MarkParkedOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        const got = reach.objects(Content).get(input.objectId as NivoRef<Content>)
        if (got.error) throw got.error
        const { error } = reach.objects(Content).update({ id: got.result.id, version: got.result.version, values: { status: "parked", nextAction: clip(input.why, 300) } })
        if (error) throw error
        return { code: got.result.values.code, parked: true }
    }
}
