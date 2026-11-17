import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../calendar-round.workflow.ts"

export class Scheduled extends NodeEnd<typeof State> {
    override readonly reason = "scheduled"
}
