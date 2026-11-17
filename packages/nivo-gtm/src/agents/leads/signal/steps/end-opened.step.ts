import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"

export class EndOpened extends NodeEnd<typeof State> {
    override readonly reason = "opened"
}
