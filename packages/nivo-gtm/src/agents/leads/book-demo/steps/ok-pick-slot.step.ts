import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../book-demo.workflow.ts"
import { IsPicked } from "./is-picked.step.ts"
import { Retry } from "./retry.step.ts"

export class OkPickSlot extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.pick.refusal === ""
    override readonly yes = IsPicked
    override readonly no = Retry
}
