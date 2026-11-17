import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { SendLineOutput } from "../common/send-line.cell.ts"
import { SetStageOutput } from "../common/set-stage.cell.ts"
import { CheckFollowUpOutput } from "./check-follow-up.cell.ts"
import { CountFollowUpOutput } from "./count-follow-up.cell.ts"
import { DraftFollowUpOutput } from "./draft-follow-up.cell.ts"
import { RetryDecisionOutput } from "../../../common/recover/retry-decision.cell.ts"
import { ParkAlertOutput } from "../../../common/recover/park-alert.cell.ts"
import { Open } from "./steps/open.step.ts"
import { Check } from "./steps/check.step.ts"
import { IsStop } from "./steps/is-stop.step.ts"
import { IsCold } from "./steps/is-cold.step.ts"
import { IsWait } from "./steps/is-wait.step.ts"
import { Wait } from "./steps/wait.step.ts"
import { Draft } from "./steps/draft.step.ts"
import { SendFollowUp } from "./steps/send-follow-up.step.ts"
import { Count } from "./steps/count.step.ts"
import { GoCold } from "./steps/go-cold.step.ts"
import { EndStopped } from "./steps/end-stopped.step.ts"
import { EndCold } from "./steps/end-cold.step.ts"
import { EndDeclined } from "./steps/end-declined.step.ts"
import { OkDraft } from "./steps/ok-draft.step.ts"
import { SentSendFollowUp } from "./steps/sent-send-follow-up.step.ts"
import { HeldSendFollowUp } from "./steps/held-send-follow-up.step.ts"
import { OkCount } from "./steps/ok-count.step.ts"
import { OkGoCold } from "./steps/ok-go-cold.step.ts"
import { Retry } from "./steps/retry.step.ts"
import { IsAgain } from "./steps/is-again.step.ts"
import { RetryWait } from "./steps/retry-wait.step.ts"
import { Resume1 } from "./steps/resume1.step.ts"
import { Resume2 } from "./steps/resume2.step.ts"
import { Resume3 } from "./steps/resume3.step.ts"
import { Resume4 } from "./steps/resume4.step.ts"
import { ParkFailed } from "./steps/park-failed.step.ts"
import { EndParked } from "./steps/end-parked.step.ts"

/** The one state object of a run: the lead it follows up, the latest check, draft and send, and what the count and the cold move did. */
export const State = z.strictObject({
    leadId: z.string().optional(),
    check: CheckFollowUpOutput.optional(),
    draft: DraftFollowUpOutput.optional(),
    sent: SendLineOutput.optional(),
    counted: CountFollowUpOutput.optional(),
    cooled: SetStageOutput.optional(),
    retry: RetryDecisionOutput.optional(),
    alert: ParkAlertOutput.optional(),
})

/**
 * `nivo-gtm.leads-nurture` (Nhắn lại khách): follows up a lead that went quiet, at the pace of the customer's settings (the gaps in days, the most follow-ups, the sending window). The check reads the
 * lead as it stands NOW, so a reply the lead wrote meanwhile (the front door answers it) moves the due time; a due follow-up is written from the lead's notes and the PUBLIC brain, a person approves it,
 * it is sent and counted, and the loop waits for the next gap. After the last follow-up the lead goes `cold`. A lead with a demo booked, won, lost or unfit ends the run.
 *
 * Failure paths (the recovery rule): a step that is refused (a model that declines or has no credit, an object write that is stale or refused, a send the channel refuses for another reason than a held route) is
 * retried `retries` times (default 3) `retryMinutes` apart (customer settings of `retry-decision`), then the run posts ONE alert card to the team room and ends `parked`. Only a refusal the callee DECLARES can be handled this way;
 * an undeclared failure still stops the run at its node for a person.
 */
export class Nurture implements Workflow<typeof State> {
    readonly key = keyOf("leads-nurture")
    readonly version = 2
    readonly title = { vi: "Nhắn lại khách", en: "Follow up a lead" }
    readonly state = State
    readonly maxLifetime = { days: 60 }
    readonly start = Open
    readonly steps = [Open, Check, IsStop, IsCold, IsWait, Wait, Draft, SendFollowUp, Count, GoCold, EndStopped, EndCold, EndDeclined, OkDraft, SentSendFollowUp, HeldSendFollowUp, OkCount, OkGoCold, Retry, IsAgain, RetryWait, Resume1, Resume2, Resume3, Resume4, ParkFailed, EndParked]
}
