import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { AskOutcome as AskOutcomeCell } from "../ask-outcome.cell.ts"
import type { State } from "../book-demo.workflow.ts"
import { WaitOutcome } from "./wait-outcome.step.ts"

export class AskOutcome extends NodeRun(AskOutcomeCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ name: s.slots.name, label: s.book.label, host: s.book.host })
    override readonly into = ["asked"] as const
    override readonly next = WaitOutcome
}
