import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { Spam } from "./spam.step.ts"
import { IsComplaint } from "./is-complaint.step.ts"
import type { State } from "../replies.workflow.ts"

/** Branch: is the message spam. */
export class IsSpam extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.sorted.kind === "spam"
    override readonly label = { vi: "Spam?", en: "Spam?" }
    override readonly yes = Spam
    override readonly no = IsComplaint
}
