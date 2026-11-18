import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialAnswer as AnswerCell } from "../answer.cell.ts"
import { IsAnswered } from "./is-answered.step.ts"
import type { State } from "../replies.workflow.ts"

/** Asks the model for a public answer from the knowledge the brain holds, or says there is none. */
export class Answer extends NodeRun(AnswerCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        text: s.messages.at(-1).text,
        summary: s.sorted.summary,
    })
    override readonly into = ["answer"] as const
    override readonly next = IsAnswered
}
