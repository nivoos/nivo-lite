import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../activate.workflow.ts"
import { Record } from "./record.step.ts"
import { Stuck } from "./stuck.step.ts"

export class Done extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answer.choice === "done"
    override readonly yes = Record
    override readonly no = Stuck
}
