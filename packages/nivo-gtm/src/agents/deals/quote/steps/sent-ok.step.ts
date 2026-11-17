import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"
import { Record } from "./record.step.ts"
import { ParkSend } from "./park-send.step.ts"

export class SentOk extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.sent === true
    override readonly yes = Record
    override readonly no = ParkSend
}
