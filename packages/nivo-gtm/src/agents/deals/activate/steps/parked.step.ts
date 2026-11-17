import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../activate.workflow.ts"

/** Parked: one alert card went to the room. */
export class Parked extends NodeEnd<typeof State> {
    override readonly reason = "parked"
}
