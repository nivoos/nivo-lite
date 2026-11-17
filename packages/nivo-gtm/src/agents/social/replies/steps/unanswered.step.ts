import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../replies.workflow.ts"

export class Unanswered extends NodeEnd<typeof State> {
    override readonly reason = "unanswered"
}
