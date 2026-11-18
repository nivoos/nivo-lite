import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { Demo } from "../../../objects/demo.object.ts"
import { LEAD_STAGES } from "../../../objects/lead.object.ts"
import { keyOf } from "../../../package-key.ts"
import { assertRef } from "../common/typed-ref.ts"

export const RecordDemoInput = z.strictObject({ demoId: z.string().min(1).max(80), choice: z.string().max(40) })
/** What the outcome means for the lead: the stage it goes to and the next action it gets. */
export const RecordDemoOutput = z.strictObject({
    demoId: z.string().max(128),
    status: z.enum(["done", "no_show", "moved"]),
    leadStage: z.enum(LEAD_STAGES),
    nextAction: z.string().min(1).max(300),
})

type In = z.infer<typeof RecordDemoInput>
type Out = z.infer<typeof RecordDemoOutput>

/** What each outcome of a demo means for the lead: the stage it goes to and the next action it gets. */
const OUTCOMES = {
    done: { leadStage: "demo_done", nextAction: "Báo giá sau demo" },
    no_show: { leadStage: "qualified", nextAction: "Khách vắng: hẹn lại demo" },
    moved: { leadStage: "qualified", nextAction: "Khách dời lịch: hẹn lại demo" },
} as const satisfies Record<Out["status"], Pick<Out, "leadStage" | "nextAction">>

/**
 * Records how the demo went: one act, `object.update` of `gtm.demo` (`done`, `no_show` or `moved`, from the host's choice; any other answer counts as `moved`). It answers the stage and next action the lead
 * gets: `demo_done` after a demo, back to `qualified` with a new demo to arrange after a no-show or a move.
 */
export class RecordDemo implements Node<typeof RecordDemoInput, typeof RecordDemoOutput> {
    readonly key = keyOf("leads-record-demo")
    readonly version = 3
    readonly title = { vi: "Ghi kết quả buổi demo", en: "Record the demo outcome" }
    readonly input = RecordDemoInput
    readonly output = RecordDemoOutput
    readonly reads = ["object.get"]
    readonly mutation = "object.update"

    run(input: In, reach: NodeReach): Out {
        assertRef<Demo>(input.demoId)
        const got = reach.objects(Demo).get(input.demoId)
        if (got.error) throw got.error
        const demo = got.result
        const status = input.choice === "done" || input.choice === "no_show" ? input.choice : "moved"
        const { leadStage, nextAction } = OUTCOMES[status]
        const { error } = reach.objects(Demo).update({
            id: demo.id,
            version: demo.version,
            values: { status, outcome: `Kết quả do người chủ trì chọn: ${status}`, nextAction, nextAt: reach.facts.at },
        })
        if (error) throw error
        return { demoId: demo.id, status, leadStage, nextAction }
    }
}
