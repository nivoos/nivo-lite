import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Readiness as ReadinessCell } from "../readiness.cell.ts"
import type { State } from "../front.workflow.ts"
import { IsReady } from "./is-ready.step.ts"

/** Runs `Readiness` (the business rule: how many touches a lead has before it is scored even without asking for a demo or a price) and keeps its result in `readiness`; the run then goes to `IsReady`. */
export class Readiness extends NodeRun(ReadinessCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        intent: s.understood.intent,
        stage: s.touched.stage,
        turns: s.touched.turns,
    })
    override readonly into = ["readiness"] as const
    override readonly next = IsReady
}
