import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { Changed } from "../common/social.shapes.ts"
import { ParkAlertOutput } from "../../../common/recover/park-alert.cell.ts"
import { MarkParkedOutput } from "../common/mark-parked.cell.ts"
import { OpenOutput } from "./open.cell.ts"
import { FinalCheckOutput } from "./final-check.cell.ts"
import { SendOutput } from "./send.cell.ts"
import { RetryOutput } from "./retry.cell.ts"
import { RecordOutput } from "./record.cell.ts"
import { MarkContentOutput } from "./mark-content.cell.ts"
import { EmitPublishedOutput } from "./emit-published.cell.ts"
import { keyOf } from "../../../package-key.ts"
import { Hear } from "./steps/hear.step.ts"
import { Open } from "./steps/open.step.ts"
import { UntilTime } from "./steps/until-time.step.ts"
import { AfterChange } from "./steps/after-change.step.ts"
import { Cancelled } from "./steps/cancelled.step.ts"
import { FinalCheck } from "./steps/final-check.step.ts"
import { IsOk } from "./steps/is-ok.step.ts"
import { Send } from "./steps/send.step.ts"
import { IsSent } from "./steps/is-sent.step.ts"
import { Retry } from "./steps/retry.step.ts"
import { IfAgain } from "./steps/if-again.step.ts"
import { RetryWait } from "./steps/retry-wait.step.ts"
import { RecordSent } from "./steps/record-sent.step.ts"
import { MarkContent } from "./steps/mark-content.step.ts"
import { Announce } from "./steps/announce.step.ts"
import { Published } from "./steps/published.step.ts"
import { MarkParked } from "./steps/mark-parked.step.ts"
import { AlertPark } from "./steps/alert-park.step.ts"
import { Parked } from "./steps/parked.step.ts"

/** The one state object of a run. */
export const State = z.strictObject({
    hear: Changed.optional(),
    slot: OpenOutput.optional(),
    change: z.strictObject({ field: z.string(), to: z.string() }).optional(),
    check: FinalCheckOutput.optional(),
    sent: SendOutput.optional(),
    retry: RetryOutput.optional(),
    recorded: RecordOutput.optional(),
    contentMarked: MarkContentOutput.optional(),
    announced: EmitPublishedOutput.optional(),
    marked: MarkParkedOutput.optional(),
    parked: ParkAlertOutput.optional(),
})

/**
 * `nivo-gtm.social-publish` (Đăng bài đúng giờ): a publication that becomes `scheduled` opens a run (one per publication). It waits for its time (a person moving the time re-reads it; cancelling ends the run), checks the post is
 * still true against the public price document, then SENDS it: the `send` step runs in `ask` mode, so a person approves every post that leaves the company. A refusal is retried `retries` times, `retryMinutes` apart, then parked
 * with ONE alert card. A channel with no provider yet (Facebook, TikTok, YouTube) ends parked as "chờ kết nối". A post that went out is recorded, its content item is `published` and `nivo-gtm.content.published` is emitted.
 */
export class Publish implements Workflow<typeof State> {
    readonly key = keyOf("social-publish")
    readonly version = 1
    readonly title = {"vi":"Đăng bài đúng giờ","en":"Publish on time"}
    readonly state = State
    readonly start = Hear
    readonly steps = [Hear, Open, UntilTime, AfterChange, Cancelled, FinalCheck, IsOk, Send, IsSent, Retry, IfAgain, RetryWait, RecordSent, MarkContent, Announce, Published, MarkParked, AlertPark, Parked]
}
