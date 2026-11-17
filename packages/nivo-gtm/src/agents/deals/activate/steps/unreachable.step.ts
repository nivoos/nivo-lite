import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../activate.workflow.ts"

/** The deal is activated and the lead won, but the channel refused the welcome (a held route or an erased contact); nothing went out. */
export class Unreachable extends NodeEnd<typeof State> {
    override readonly reason = "unreachable"
}
