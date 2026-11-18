import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Understand as UnderstandCell } from "../understand.cell.ts"
import type { State } from "../front.workflow.ts"
import { IsSpam } from "./is-spam.step.ts"

/** Runs `Understand` (where the lead stands and what the team is waiting for from them: a pick of a demo time reads in that light) and keeps its result in `understood`; the run then goes to `IsSpam`. */
export class Understand extends NodeRun(UnderstandCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        messages: s.messages,
        stage: s.lead.stage,
        nextAction: s.lead.nextAction,
    })
    override readonly into = ["understood"] as const
    override readonly next = IsSpam
}
