import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { MarkCutApproved } from "./mark-cut-approved.step.ts"
import { MarkCutFix } from "./mark-cut-fix.step.ts"
import type { State } from "../review-cut.workflow.ts"

/** Branches on the person's answer: `cut-approve` approves the cut, any other cut answer sends it back. */
export class IsApproved extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answers.at(-1).choice === "cut-approve"
    override readonly label = { vi: "Bản dựng được duyệt?", en: "Cut approved?" }
    override readonly yes = MarkCutApproved
    override readonly no = MarkCutFix
}
