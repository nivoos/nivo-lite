import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../qualify.workflow.ts"
import { Save } from "./save.step.ts"
import { Retry } from "./retry.step.ts"

export class OkScore extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.score.refusal === ""
    override readonly yes = Save
    override readonly no = Retry
}
