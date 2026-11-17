import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SetStage as SetStageCell } from "../../common/set-stage.cell.ts"
import type { State } from "../nurture.workflow.ts"
import { OkGoCold } from "./ok-go-cold.step.ts"

export class GoCold extends NodeRun(SetStageCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId, stage: "cold" as const, nextAction: "Xem lại sau 30 ngày", nextAtMs: 0, nextAfterHours: 720 })
    override readonly into = ["cooled"] as const
    override readonly next = OkGoCold
}
