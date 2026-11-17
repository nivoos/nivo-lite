import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"

/** No money after the one reminder; the sales room was told. */
export class Unpaid extends NodeEnd<typeof State> {
    override readonly reason = "unpaid"
}
