import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../activate.workflow.ts"

/** Activated, won and welcomed (or the welcome was declined by a person). */
export class Closed extends NodeEnd<typeof State> {
    override readonly reason = "closed"
}
