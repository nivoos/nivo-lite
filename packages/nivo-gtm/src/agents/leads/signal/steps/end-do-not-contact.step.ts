import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../signal.workflow.ts"

export class EndDoNotContact extends NodeEnd<typeof State> {
    override readonly reason = "do_not_contact"
}
