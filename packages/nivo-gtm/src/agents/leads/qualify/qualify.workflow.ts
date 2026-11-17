import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { LeadReadyData } from "../../../common/events/lead-ready.event.ts"
import { keyOf } from "../../../package-key.ts"
import { EmitLeadQualifiedOutput } from "../common/emit-lead-qualified.cell.ts"
import { SaveScoreOutput } from "./save-score.cell.ts"
import { ScoreOutput } from "./score.cell.ts"
import { RetryDecisionOutput } from "../../../common/recover/retry-decision.cell.ts"
import { ParkAlertOutput } from "../../../common/recover/park-alert.cell.ts"
import { Open } from "./steps/open.step.ts"
import { Score } from "./steps/score.step.ts"
import { Save } from "./steps/save.step.ts"
import { IsQualified } from "./steps/is-qualified.step.ts"
import { EmitQualified } from "./steps/emit-qualified.step.ts"
import { EndScored } from "./steps/end-scored.step.ts"
import { EndQualified } from "./steps/end-qualified.step.ts"
import { OkScore } from "./steps/ok-score.step.ts"
import { OkSave } from "./steps/ok-save.step.ts"
import { Retry } from "./steps/retry.step.ts"
import { IsAgain } from "./steps/is-again.step.ts"
import { RetryWait } from "./steps/retry-wait.step.ts"
import { Resume1 } from "./steps/resume1.step.ts"
import { Resume2 } from "./steps/resume2.step.ts"
import { ParkFailed } from "./steps/park-failed.step.ts"
import { EndParked } from "./steps/end-parked.step.ts"

/** The one state object of a run: the ready event that opened it (appended), the score, what was saved and the emitted event. */
export const State = z.strictObject({
    readies: z.array(LeadReadyData).max(5).optional(),
    score: ScoreOutput.optional(),
    saved: SaveScoreOutput.optional(),
    emitted: EmitLeadQualifiedOutput.optional(),
    retry: RetryDecisionOutput.optional(),
    alert: ParkAlertOutput.optional(),
})
export type Ready = z.infer<typeof LeadReadyData>

/**
 * `nivo-gtm.leads-qualify` (Chấm điểm khách): an INTERNAL run, nothing in it reaches a customer. The lead and the internal ideal-customer rubric are read, ONE generation scores the lead 0 to 100
 * with the segment and the reasons, the score is saved on the lead (qualified from `qualifyAt`, unfit under `dropBelow`: customer settings with defaults), and a qualified lead is announced to the
 * booking.
 *
 * Failure paths (the recovery rule): a step that is refused (a model that declines or has no credit, an object write that is stale or refused, a send the channel refuses for another reason than a held route) is
 * retried `retries` times (default 3) `retryMinutes` apart (customer settings of `retry-decision`), then the run posts ONE alert card to the team room and ends `parked`. Only a refusal the callee DECLARES can be handled this way;
 * an undeclared failure still stops the run at its node for a person.
 */
export class Qualify implements Workflow<typeof State> {
    readonly key = keyOf("leads-qualify")
    readonly version = 2
    readonly title = { vi: "Chấm điểm khách", en: "Qualify a lead" }
    readonly state = State
    readonly append = ["readies"] as const
    readonly start = Open
    readonly steps = [Open, Score, Save, IsQualified, EmitQualified, EndScored, EndQualified, OkScore, OkSave, Retry, IsAgain, RetryWait, Resume1, Resume2, ParkFailed, EndParked]
}
