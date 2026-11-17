import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import type { DemoDone } from "../../../common/events/demo-done.event.ts"
import { keyOf } from "../../../package-key.ts"

export const EmitDemoDoneInput = z.strictObject({ leadId: z.string().min(1).max(80), code: z.string().min(1).max(60), demoId: z.string().min(1).max(80), note: z.string().max(500) })
export const EmitDemoDoneOutput = z.strictObject({ emitted: z.literal(true) })

type In = z.infer<typeof EmitDemoDoneInput>
type Out = z.infer<typeof EmitDemoDoneOutput>

/** Says the demo was held: one act, `events.emit` of `DemoDone` on the subject `lead:<code>`, keyed by the demo (Deals opens the deal from it). */
export class EmitDemoDone implements Node<typeof EmitDemoDoneInput, typeof EmitDemoDoneOutput> {
    readonly key = keyOf("leads-emit-demo-done")
    readonly version = 1
    readonly title = { vi: "Báo demo xong", en: "Say the demo is done" }
    readonly input = EmitDemoDoneInput
    readonly output = EmitDemoDoneOutput
    readonly reads = []
    readonly mutation = "events.emit"

    run(input: In, reach: NodeReach): Out {
        const { error } = reach.emit<typeof DemoDone>("nivo-gtm.demo.done", {
            subject: { kind: "lead", id: input.code },
            data: { leadId: input.leadId, demoId: input.demoId, note: input.note },
            key: `${input.demoId}:done`,
        })
        if (error) throw error
        return { emitted: true }
    }
}
