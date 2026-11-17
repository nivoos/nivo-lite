import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Understand as UnderstandCell } from "../understand.cell.ts"
import type { State } from "../front.workflow.ts"
import { OkUnderstand } from "./ok-understand.step.ts"

export class Understand extends NodeRun(UnderstandCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ messages: s.messages, stage: s.lead.stage, nextAction: s.lead.nextAction })
    override readonly into = ["understood"] as const
    override readonly next = OkUnderstand
}
