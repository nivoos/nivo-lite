import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioEmitCutReady as EmitCutReadyCell } from "../emit-cut-ready.cell.ts"
import { WaitVerdict } from "./wait-verdict.step.ts"
import type { State } from "../produce.workflow.ts"

/** Announces that a cut is recorded (`nivo-gtm.cut.ready` on the content item), which opens the `review-cut` workflow. */
export class EmitCutReady extends NodeRun(EmitCutReadyCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({
        contentId: s.recorded.contentId,
        cutId: s.recorded.cutId,
        version: s.recorded.version,
    })
    override readonly into = ["emitted"] as const
    override readonly next = WaitVerdict
}
