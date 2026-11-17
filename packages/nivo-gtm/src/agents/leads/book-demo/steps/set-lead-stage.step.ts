import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SetStage as SetStageCell } from "../../common/set-stage.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { IsDone } from "./is-done.step.ts"

export class SetLeadStage extends NodeRun(SetStageCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId, stage: s.recorded.leadStage, nextAction: s.recorded.nextAction, nextAtMs: 0, nextAfterHours: 24 })
    override readonly into = ["leadStaged"] as const
    override readonly next = IsDone
}
