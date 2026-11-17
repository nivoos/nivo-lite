import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"

/** The deal is paid; the activation takes over. */
export class Paid extends NodeEnd<typeof State> {
    override readonly reason = "paid"
}
