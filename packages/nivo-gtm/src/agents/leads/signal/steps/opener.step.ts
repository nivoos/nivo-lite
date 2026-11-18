import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Opener as OpenerCell } from "../opener.cell.ts"
import type { State } from "../signal.workflow.ts"
import { SendOpener } from "./send-opener.step.ts"

/** Runs `Opener` (how many brain hits the opener reads) and keeps its result in `opener`; the run then goes to `SendOpener`. */
export class Opener extends NodeRun(OpenerCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ source: s.signals[0].source, note: s.signals[0].note })
    override readonly into = ["opener"] as const
    override readonly next = SendOpener
}
