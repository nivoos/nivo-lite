import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../activate.workflow.ts"
import { Closed } from "./closed.step.ts"
import { ParkWelcome } from "./park-welcome.step.ts"

export class SentOk extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sent.sent === true
    override readonly yes = Closed
    override readonly no = ParkWelcome
}
