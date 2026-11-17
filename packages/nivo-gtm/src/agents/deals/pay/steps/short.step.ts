import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../pay.workflow.ts"

/** A transfer with the right code but less money than the deal; the sales room was told. */
export class Short extends NodeEnd<typeof State> {
    override readonly reason = "short"
}
