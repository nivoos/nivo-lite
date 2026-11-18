import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../pick.workflow.ts"

/** The choice is written; the status write opens the `script` or `post-draft` workflow. */
export class Picked extends NodeEnd<typeof State> {
    override readonly reason = "picked"
}
