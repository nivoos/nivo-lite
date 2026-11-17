import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../handover.workflow.ts"

/** No answer in a day; the deal waits in proposal with its next action (quote within the setting's hours). */
export class Waiting extends NodeEnd<typeof State> {
    override readonly reason = "waiting"
}
