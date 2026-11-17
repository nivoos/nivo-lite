import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../quote.workflow.ts"

/** The quote is out; the deal is quoted. */
export class Quoted extends NodeEnd<typeof State> {
    override readonly reason = "quoted"
}
