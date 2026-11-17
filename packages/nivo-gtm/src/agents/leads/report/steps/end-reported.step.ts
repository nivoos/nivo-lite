import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../report.workflow.ts"

export class EndReported extends NodeEnd<typeof State> {
    override readonly reason = "reported"
}
