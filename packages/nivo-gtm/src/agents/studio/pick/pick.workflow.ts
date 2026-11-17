import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { RoomAnswer } from "../common/studio.shapes.ts"
import { ApplyChoiceOutput } from "./apply-choice.cell.ts"
import { keyOf } from "../../../package-key.ts"
import { Hear } from "./steps/hear.step.ts"
import { ApplyChoice } from "./steps/apply-choice.step.ts"
import { Picked } from "./steps/picked.step.ts"

/** The one state object of a run. */
export const State = z.strictObject({ answers: z.array(RoomAnswer).max(20).optional(), applied: ApplyChoiceOutput.optional() })
export type Answer = z.infer<typeof RoomAnswer>

/**
 * `nivo-gtm.studio-pick` (Chọn ý tưởng): a person's answer to the ideas card (`idea-choose:<code>` or `idea-drop:<day>`) opens a run; the choice is written to the idea (`chosen` or `dropped`). An answer to any other card is
 * filtered out at the start wait. The status write opens the `script` workflow (a video) or the Social agent's `post-draft` (a post).
 */
export class Pick implements Workflow<typeof State> {
    readonly key = keyOf("studio-pick")
    readonly version = 1
    readonly title = {"vi":"Chọn ý tưởng","en":"Pick an idea"}
    readonly state = State
    readonly append = ["answers"] as const
    readonly start = Hear
    readonly steps = [Hear, ApplyChoice, Picked]
}
