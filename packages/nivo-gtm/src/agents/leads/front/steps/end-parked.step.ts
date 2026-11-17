import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../front.workflow.ts"

export class EndParked extends NodeEnd<typeof State> {
    override readonly reason = "parked"
}
