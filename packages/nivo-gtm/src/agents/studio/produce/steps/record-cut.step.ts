import { NodeRun, type StateView } from "@starci/nivoos-sdk"
import { StudioRecordCut as RecordCutCell } from "../record-cut.cell.ts"
import { EmitCutReady } from "./emit-cut-ready.step.ts"
import type { State } from "../produce.workflow.ts"

/** Records the cut the editor delivered, with its file link, as the next `video cut` object of the item. */
export class RecordCut extends NodeRun(RecordCutCell)<typeof State> {
    override readonly input = (s: StateView<typeof State>) => ({ objectId: s.change.objectId, link: s.cut.link })
    override readonly into = ["recorded"] as const
    override readonly next = EmitCutReady
}
