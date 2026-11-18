import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Notice } from "./notice.step.ts"
import { IsInterest } from "./is-interest.step.ts"
import type { State } from "../replies.workflow.ts"

/** Branch: is the message a complaint, which a person must handle. */
export class IsComplaint extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sorted.kind === "complaint"
    override readonly label = { vi: "Khiếu nại?", en: "A complaint?" }
    override readonly yes = Notice
    override readonly no = IsInterest
}
