import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { SocialLeadSignal as LeadSignalCell } from "../lead-signal.cell.ts"
import { Answer } from "./answer.step.ts"
import type { State } from "../replies.workflow.ts"

/** Signals the sales side that the message shows interest in buying. */
export class Signal extends NodeRun(LeadSignalCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        fromId: s.messages.at(-1).fromId,
        messageId: s.messages.at(-1).messageId,
        summary: s.sorted.summary,
    })
    override readonly into = ["signalled"] as const
    override readonly next = Answer
}
