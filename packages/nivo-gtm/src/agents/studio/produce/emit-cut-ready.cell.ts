import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { CutReady } from "../../../common/events/cut-ready.event.ts"
import { keyOf } from "../../../package-key.ts"

export const EmitCutReadyInput = z.strictObject({ contentId: z.string().min(1), cutId: z.string().min(1), version: z.number().int().min(1) })
export const EmitCutReadyOutput = z.strictObject({ eventKey: z.string() })

type In = z.infer<typeof EmitCutReadyInput>
type Out = z.infer<typeof EmitCutReadyOutput>

/**
 * `nivo-gtm.studio-emit-cut-ready` (Báo bản dựng sẵn sàng): one act, `events.emit` of `nivo-gtm.cut.ready` on the subject `content:<id>`, keyed by the cut, so a rerun writes nothing new. The `review-cut` workflow
 * starts on it.
 */
export class StudioEmitCutReady implements Node<typeof EmitCutReadyInput, typeof EmitCutReadyOutput> {
    readonly key = keyOf("studio-emit-cut-ready")
    readonly version = 1
    readonly title = { vi: "Báo bản dựng sẵn sàng", en: "Announce the cut" }
    readonly input = EmitCutReadyInput
    readonly output = EmitCutReadyOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const key = `cut:${input.cutId}`
        const { error } = reach.emit<typeof CutReady>("nivo-gtm.cut.ready", { subject: { kind: "content", id: input.contentId }, data: { contentId: input.contentId, cutId: input.cutId, version: input.version }, key })
        if (error) throw error
        return { eventKey: key }
    }
}
