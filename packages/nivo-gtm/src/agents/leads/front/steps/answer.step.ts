import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { Answer as AnswerCell } from "../answer.cell.ts"
import type { State } from "../front.workflow.ts"
import { HasAnswer } from "./has-answer.step.ts"

/** Runs `Answer` (`answered` false: the public information does not answer; `question` is then what the team must answer, and nothing is sent) and keeps its result in `answer`; the run then goes to `HasAnswer`. */
export class Answer extends NodeRun(AnswerCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ messages: s.messages, summary: s.understood.summary })
    override readonly into = ["answer"] as const
    override readonly next = HasAnswer
}
