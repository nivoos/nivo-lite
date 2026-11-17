import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Cancelled } from "./cancelled.step.ts"
import { Open } from "./open.step.ts"
import type { State } from "../publish.workflow.ts"

export class AfterChange extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.change.to === "cancelled"
    override readonly label = { vi: "Bị hủy?", en: "Cancelled?" }
    override readonly yes = Cancelled
    override readonly no = Open
}
