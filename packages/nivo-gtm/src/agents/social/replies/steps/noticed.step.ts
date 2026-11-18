import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../replies.workflow.ts"

/** The team was told and a person takes over: the run ends. */
export class Noticed extends NodeEnd<typeof State> {
    override readonly reason = "person"
}
