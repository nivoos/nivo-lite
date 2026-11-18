import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import { ApproveScript } from "./approve-script.step.ts"
import { Revise } from "./revise.step.ts"
import type { State } from "../script.workflow.ts"

/** Branches on the person's answer: `script-approve` approves the script, any other script answer asks for a rewrite. */
export class IsApproved extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.answers.at(-1).choice === "script-approve"
    override readonly label = { vi: "Kịch bản được duyệt?", en: "Script approved?" }
    override readonly yes = ApproveScript
    override readonly no = Revise
}
