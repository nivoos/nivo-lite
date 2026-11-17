import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../script.workflow.ts"

/** The script is `script_ok`: the `produce` workflow starts on that write. */
export class Approved extends NodeEnd<typeof State> {
    override readonly reason = "script-approved"
}
