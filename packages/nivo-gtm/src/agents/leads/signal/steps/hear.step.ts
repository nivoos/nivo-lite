import { NodeWait, take } from "@starci/nivoos-sdk"
import { LeadSignal } from "../../../../common/events/lead-signal.event.ts"
import type { State, SignalItem } from "../signal.workflow.ts"
import { FindLead } from "./find-lead.step.ts"

/** The start: Social (or a sheet import) saw interest and emitted a signal on the lead's address. */
export class Hear extends NodeWait<typeof State> {
    override readonly take = [take<typeof State>(LeadSignal, {}, (s, signals: SignalItem[]) => { signals.forEach((signal) => s.signals.push(signal)) })]
    override readonly next = FindLead
}
