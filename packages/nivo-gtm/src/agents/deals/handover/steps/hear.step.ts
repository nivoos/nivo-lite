import { NodeWait, take } from "@starci/nivoos-sdk"
import { DemoDone } from "../../../../common/events/demo-done.event.ts"
import type { State, Demo } from "../handover.workflow.ts"
import { Brief } from "./brief.step.ts"

/** The start: a demo that ended. */
export class Hear extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(DemoDone, {}, (s, demos: Demo[]) => { const [first] = demos; if (first !== undefined) s.event = first }),
    ]
    override readonly next = Brief
}
