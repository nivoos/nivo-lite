import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../pick.workflow.ts"

export class Picked extends NodeEnd<typeof State> {
    override readonly reason = "picked"
}
