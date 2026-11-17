import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../publish.workflow.ts"

export class Cancelled extends NodeEnd<typeof State> {
    override readonly reason = "cancelled"
}
