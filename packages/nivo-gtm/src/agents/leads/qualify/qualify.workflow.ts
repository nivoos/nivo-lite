import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { LeadReadyData } from "../../../common/events/lead-ready.event.ts"
import { keyOf } from "../../../package-key.ts"
import { EmitLeadQualifiedOutput } from "../common/emit-lead-qualified.cell.ts"
import { SaveScoreOutput } from "./save-score.cell.ts"
import { ScoreOutput } from "./score.cell.ts"
import { Open } from "./steps/open.step.ts"
import { Score } from "./steps/score.step.ts"
import { Save } from "./steps/save.step.ts"
import { IsQualified } from "./steps/is-qualified.step.ts"
import { EmitQualified } from "./steps/emit-qualified.step.ts"
import { EndScored } from "./steps/end-scored.step.ts"
import { EndQualified } from "./steps/end-qualified.step.ts"

/** The one state object of a run: the ready event that opened it (appended), the score, what was saved and the emitted event. */
export const State = z.strictObject({
    readies: z.array(LeadReadyData).max(5).optional(),
    score: ScoreOutput.optional(),
    saved: SaveScoreOutput.optional(),
    emitted: EmitLeadQualifiedOutput.optional(),
})
/** The `LeadReady` event the scoring run starts from: a lead the front door found ready to be scored. */
export type Ready = z.infer<typeof LeadReadyData>

/**
 * `nivo-gtm.leads-qualify` (Chấm điểm khách): an INTERNAL run, nothing in it reaches a customer. The lead and the internal ideal-customer rubric are read, ONE generation scores the lead 0 to 100
 * with the segment and the reasons, the score is saved on the lead (qualified from `qualifyAt`, unfit under `dropBelow`: customer settings with defaults), and a qualified lead is announced to the
 * booking.
 */
export class Qualify implements Workflow<typeof State> {
    readonly key = keyOf("leads-qualify")
    readonly version = 3
    readonly title = { vi: "Chấm điểm khách", en: "Qualify a lead" }
    readonly state = State
    readonly append = ["readies"] as const
    readonly start = Open
    readonly steps = [Open, Score, Save, IsQualified, EmitQualified, EndScored, EndQualified]
}
