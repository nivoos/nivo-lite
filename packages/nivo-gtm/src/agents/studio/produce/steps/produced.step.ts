import { NodeEnd } from "@starci/nivoos-sdk"
import type { State } from "../produce.workflow.ts"

/** The cut is approved: the video is ready for the Social agent. */
export class Produced extends NodeEnd<typeof State> {
    override readonly reason = "produced"
}
