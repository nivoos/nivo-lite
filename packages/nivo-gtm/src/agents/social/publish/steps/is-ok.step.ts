import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Send } from "./send.step.ts"
import { Outdated } from "./outdated.step.ts"
import type { State } from "../publish.workflow.ts"

export class IsOk extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.check.ok === true
    override readonly label = { vi: "Bài còn đúng?", en: "Still true?" }
    override readonly yes = Send
    override readonly no = Outdated
}
