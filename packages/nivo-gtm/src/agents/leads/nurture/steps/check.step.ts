import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { CheckFollowUp as CheckFollowUpCell } from "../check-follow-up.cell.ts"
import type { State } from "../nurture.workflow.ts"
import { IsStop } from "./is-stop.step.ts"

/** Runs `CheckFollowUp` (what the nurture loop does next: `send` (a follow-up is due and inside the sending window), `wait` (until `waitUntilMs`), `cold` (the lead has had every follow-up and stays silent) or `stop` (the lead is no longer one to follow up: a demo is booked, it is won, lost or unfit, or it asked not to be contacted)) and keeps its result in `check`; the run then goes to `IsStop`. */
export class Check extends NodeRun(CheckFollowUpCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ leadId: s.leadId })
    override readonly into = ["check"] as const
    override readonly next = IsStop
}
