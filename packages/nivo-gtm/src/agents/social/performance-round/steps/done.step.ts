import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../performance-round.workflow.ts"

/** The day metrics are saved (and the Monday report sent when it is Monday): the run ends. */
export class Done extends NodeEnd<typeof State> {
    override readonly reason = "done"
}
