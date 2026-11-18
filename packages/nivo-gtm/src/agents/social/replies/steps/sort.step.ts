import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialSort as SortCell } from "../sort.cell.ts"
import { IsSpam } from "./is-spam.step.ts"
import type { State } from "../replies.workflow.ts"

/** Asks the model to sort the message as spam, complaint, interest or question. */
export class Sort extends NodeRun(SortCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        text: s.messages.at(-1).text,
        fromName: s.messages.at(-1).fromName,
    })
    override readonly into = ["sorted"] as const
    override readonly next = IsSpam
}
