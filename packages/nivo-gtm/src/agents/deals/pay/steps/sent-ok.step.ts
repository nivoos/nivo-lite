import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"
import { Watch1 } from "./watch-1.step.ts"
import { ParkSend } from "./park-send.step.ts"

export class SentOk extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.sent === true
    override readonly yes = Watch1
    override readonly no = ParkSend
}
