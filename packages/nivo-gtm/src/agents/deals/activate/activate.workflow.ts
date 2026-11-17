import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { DealPaidData } from "../../../common/events/deal-paid.event.ts"
import { keyOf } from "../../../package-key.ts"
import { ReadDealOutput } from "../cells/read-deal.cell.ts"
import { RequestActivationOutput } from "../cells/request-activation.cell.ts"
import { SendWelcomeOutput } from "../cells/send-welcome.cell.ts"
import { UpdateDealOutput } from "../cells/update-deal.cell.ts"
import { UpdateLeadOutput } from "../cells/update-lead.cell.ts"
import { Hear } from "./steps/hear.step.ts"
import { Read } from "./steps/read.step.ts"
import { Request } from "./steps/request.step.ts"
import { Activated } from "./steps/activated.step.ts"
import { Done } from "./steps/done.step.ts"
import { Record } from "./steps/record.step.ts"
import { Win } from "./steps/win.step.ts"
import { Welcome } from "./steps/welcome.step.ts"
import { Closed } from "./steps/closed.step.ts"
import { Late } from "./steps/late.step.ts"
import { Stuck } from "./steps/stuck.step.ts"
import { Unreachable } from "./steps/unreachable.step.ts"

/** What the engine tells a run about the answer of a room card. */
export const Answer = z.strictObject({ answerKey: z.string(), messageId: z.string(), roomId: z.string(), runId: z.string(), stepKey: z.string(), choice: z.string(), memberId: z.string() })
export type Answer = z.infer<typeof Answer>
export type Paid = z.infer<typeof DealPaidData>

/** The one state object of a run: the paid deal, what was read of it, the activation card and answer, the records and the welcome. */
export const State = z.strictObject({
    event: DealPaidData.optional(),
    deal: ReadDealOutput.optional(),
    asked: RequestActivationOutput.optional(),
    answer: Answer.optional(),
    recorded: UpdateDealOutput.optional(),
    won: UpdateLeadOutput.optional(),
    sent: SendWelcomeOutput.optional(),
})

/**
 * `nivo-gtm.deals-activate` (Kích hoạt gói): a deal that was paid (`nivo-gtm.deal.paid`). Activation is a PERSON'S step until the platform is a provider: a card goes to the activator (setting) with the plan to set
 * up; "Đã kích hoạt" records the deal `activated`, marks the lead `won` and offers the customer a welcome (a person approves the send, locked). No answer in a day ends `late`, "Chưa làm được" ends `stuck`, a welcome the channel refuses ends `unreachable`.
 */
export class Activate implements Workflow<typeof State> {
    readonly key = keyOf("deals-activate")
    readonly version = 3
    readonly title = { vi: "Kích hoạt gói", en: "Activate the plan" }
    readonly state = State
    readonly start = Hear
    readonly steps = [Hear, Read, Request, Activated, Done, Record, Win, Welcome, Closed, Late, Stuck, Unreachable]
}
