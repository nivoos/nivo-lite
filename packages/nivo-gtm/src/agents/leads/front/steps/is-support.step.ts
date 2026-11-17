import { NodeIf, type StateView } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"
import { NoticeSupport } from "./notice-support.step.ts"
import { Answer } from "./answer.step.ts"

export class IsSupport extends NodeIf<typeof State> {
    override readonly when = (s: StateView<typeof State>) => s.understood.intent === "customer_support"
    override readonly yes = NoticeSupport
    override readonly no = Answer
}
