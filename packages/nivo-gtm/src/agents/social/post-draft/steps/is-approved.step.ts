import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Approve } from "./approve.step.ts"
import { Revise } from "./revise.step.ts"
import type { State } from "../post-draft.workflow.ts"

export class IsApproved extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answers.at(-1).choice === "post-approve"
    override readonly label = { vi: "Bài đã duyệt?", en: "Post approved?" }
    override readonly yes = Approve
    override readonly no = Revise
}
