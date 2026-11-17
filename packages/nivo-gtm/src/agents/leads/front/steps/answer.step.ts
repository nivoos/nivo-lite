import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Answer as AnswerCell } from "../answer.cell.ts"
import type { State } from "../front.workflow.ts"
import { OkAnswer } from "./ok-answer.step.ts"

export class Answer extends NodeRun(AnswerCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ messages: s.messages, summary: s.understood.summary })
    override readonly into = ["answer"] as const
    override readonly next = OkAnswer
}
