import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"
import { GoCold } from "./go-cold.step.ts"
import { IsWait } from "./is-wait.step.ts"

export class IsCold extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.check.action === "cold"
    override readonly yes = GoCold
    override readonly no = IsWait
}
