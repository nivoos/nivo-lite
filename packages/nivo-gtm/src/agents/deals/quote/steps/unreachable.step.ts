import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"

/** The channel refused the quote (a member holds the route, or the contact was erased); nothing went out. */
export class Unreachable extends NodeEnd<typeof State> {
    override readonly reason = "unreachable"
}
