import { NodeWait, take } from "@starci/nivoos-sdk"
import { CutReady } from "../../../../common/events/cut-ready.event.ts"
import { ReadCut } from "./read-cut.step.ts"
import type { State, Cut } from "../review-cut.workflow.ts"

/** `nivo-gtm.cut.ready` on the subject `content:<id>`: one run per content item. */
export class Open extends NodeWait<typeof State> {
    override readonly take = [
        take<typeof State>(CutReady, {}, (s, cuts: Cut[]) => { const [first] = cuts; if (first !== undefined) s.cut = first }),
    ]
    override readonly next = ReadCut
}
