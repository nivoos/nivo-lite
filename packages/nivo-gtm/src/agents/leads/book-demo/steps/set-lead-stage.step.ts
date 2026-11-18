import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SetStage as SetStageCell } from "../../common/set-stage.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { IsDone } from "./is-done.step.ts"

/** Runs `SetStage` (the instant the next action falls due (ms since the epoch); 0 means `nextAfterHours` from now) and keeps its result in `leadStaged`; the run then goes to `IsDone`. */
export class SetLeadStage extends NodeRun(SetStageCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        leadId: s.leadId,
        stage: s.recorded.leadStage,
        nextAction: s.recorded.nextAction,
        nextAtMs: 0,
        nextAfterHours: 24,
    })
    override readonly into = ["leadStaged"] as const
    override readonly next = IsDone
}
