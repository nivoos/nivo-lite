import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../report.workflow.ts"

/** Ends the run with the reason `reported`: the leads report was posted to the team. */
export class EndReported extends NodeEnd<typeof State> {
    override readonly reason = "reported"
}
