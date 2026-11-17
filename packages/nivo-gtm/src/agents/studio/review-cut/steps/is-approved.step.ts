import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { MarkCutApproved } from "./mark-cut-approved.step.ts"
import { MarkCutFix } from "./mark-cut-fix.step.ts"
import type { State } from "../review-cut.workflow.ts"

export class IsApproved extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answers.at(-1).choice === "cut-approve"
    override readonly label = { vi: "Bản dựng được duyệt?", en: "Cut approved?" }
    override readonly yes = MarkCutApproved
    override readonly no = MarkCutFix
}
