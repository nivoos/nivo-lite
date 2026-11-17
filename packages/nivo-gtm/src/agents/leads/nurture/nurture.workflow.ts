import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { SendLineOutput } from "../common/send-line.cell.ts"
import { SetStageOutput } from "../common/set-stage.cell.ts"
import { CheckFollowUpOutput } from "./check-follow-up.cell.ts"
import { CountFollowUpOutput } from "./count-follow-up.cell.ts"
import { DraftFollowUpOutput } from "./draft-follow-up.cell.ts"
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

/** The one state object of a run: the lead it follows up, the latest check, draft and send, and what the count and the cold move did. */
export const State = z.strictObject({
    leadId: z.string().optional(),
    check: CheckFollowUpOutput.optional(),
    draft: DraftFollowUpOutput.optional(),
    sent: SendLineOutput.optional(),
    counted: CountFollowUpOutput.optional(),
    cooled: SetStageOutput.optional(),
})

/**
 * `nivo-gtm.leads-nurture` (Nhắn lại khách): follows up a lead that went quiet, at the pace of the customer's settings (the gaps in days, the most follow-ups, the sending window). The check reads the
 * lead as it stands NOW, so a reply the lead wrote meanwhile (the front door answers it) moves the due time; a due follow-up is written from the lead's notes and the PUBLIC brain, a person approves it,
 * it is sent and counted, and the loop waits for the next gap. After the last follow-up the lead goes `cold`. A lead with a demo booked, won, lost or unfit ends the run. A send to a held route or an erased contact ends it `declined`.
 */
export class Nurture implements Workflow<typeof State> {
    readonly key = keyOf("leads-nurture")
    readonly version = 3
    readonly title = { vi: "Nhắn lại khách", en: "Follow up a lead" }
    readonly state = State
    readonly maxLifetime = { days: 60 }
    readonly start = Open
    readonly steps = [Open, Check, IsStop, IsCold, IsWait, Wait, Draft, SendFollowUp, Count, GoCold, EndStopped, EndCold, EndDeclined]
}
