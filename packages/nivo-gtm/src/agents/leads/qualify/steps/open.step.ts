import { NodeWait, take } from "@starci/nivoos-sdk"
import { LeadReady } from "../../../../common/events/lead-ready.event.ts"
import type { State, Ready } from "../qualify.workflow.ts"
import { Score } from "./score.step.ts"

/** The start: the front door said a lead is ready to be scored. */
export class Open extends NodeWait<typeof State> {
    override readonly take = [take<typeof State>(LeadReady, {}, (s, readies: Ready[]) => { readies.forEach((ready) => s.readies.push(ready)) })]
    override readonly next = Score
}
