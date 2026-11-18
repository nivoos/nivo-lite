import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioApplyChoice as ApplyChoiceCell } from "../apply-choice.cell.ts"
import { Picked } from "./picked.step.ts"
import type { State } from "../pick.workflow.ts"

/** Writes the person's latest choice to the idea: `chosen` or `dropped`, with the owner and next action. */
export class ApplyChoice extends NodeRun(ApplyChoiceCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        choice: s.answers.at(-1).choice,
        memberId: s.answers.at(-1).memberId,
    })
    override readonly into = ["applied"] as const
    override readonly next = Picked
}
