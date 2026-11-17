import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Produced } from "./produced.step.ts"
import { Rework } from "./rework.step.ts"
import type { State } from "../produce.workflow.ts"

export class IsApproved extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.verdict.to === "approved"
    override readonly label = { vi: "Bản dựng được duyệt?", en: "Cut approved?" }
    override readonly yes = Produced
    override readonly no = Rework
}
