import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../produce.workflow.ts"

/** The due date passed with no cut: the item is parked and ONE alert card was posted. */
export class Parked extends NodeEnd<typeof State> {
    override readonly reason = "overdue"
}
