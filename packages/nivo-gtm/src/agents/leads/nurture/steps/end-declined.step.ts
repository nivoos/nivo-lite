import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../nurture.workflow.ts"

export class EndDeclined extends NodeEnd<typeof State> {
    override readonly reason = "declined"
}
