import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../calendar-round.workflow.ts"

/** The reviewer asked for changes: the week's publications are cancelled. */
export class ChangesAsked extends NodeEnd<typeof State> {
    override readonly reason = "changes_asked"
}
