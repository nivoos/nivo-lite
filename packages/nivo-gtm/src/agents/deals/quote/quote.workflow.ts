import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { AskOwnerOutput } from "../cells/ask-owner.cell.ts"
import { PriceOutput } from "../cells/price.cell.ts"
import { ReadDealOutput } from "../cells/read-deal.cell.ts"
import { SendQuoteOutput } from "../cells/send-quote.cell.ts"
import { UpdateDealOutput } from "../cells/update-deal.cell.ts"
import { Open } from "./steps/open.step.ts"
import { Read } from "./steps/read.step.ts"
import { Price } from "./steps/price.step.ts"
import { PriceOk } from "./steps/price-ok.step.ts"
import { NeedsOwner } from "./steps/needs-owner.step.ts"
import { AskOwner } from "./steps/ask-owner.step.ts"
import { OwnerAnswer } from "./steps/owner-answer.step.ts"
import { OwnerOk } from "./steps/owner-ok.step.ts"
import { SendQuote } from "./steps/send-quote.step.ts"
import { Record } from "./steps/record.step.ts"
import { Quoted } from "./steps/quoted.step.ts"
import { PriceRefused } from "./steps/price-refused.step.ts"
import { OwnerSilent } from "./steps/owner-silent.step.ts"
import { Unreachable } from "./steps/unreachable.step.ts"
import { OwnerDeclined } from "./steps/owner-declined.step.ts"
import { Declined } from "./steps/declined.step.ts"

/** What the engine tells a run about the answer of a room card. */
export const Answer = z.strictObject({ answerKey: z.string(), messageId: z.string(), roomId: z.string(), runId: z.string(), stepKey: z.string(), choice: z.string(), memberId: z.string() })
export type Answer = z.infer<typeof Answer>

/** The one state object of a run: the deal written, what was read of it, the price, the owner's card and answer, the send and the record. */
export const State = z.strictObject({
    change: z.strictObject({ objectId: z.string(), version: z.number().int() }).optional(),
    deal: ReadDealOutput.optional(),
    price: PriceOutput.optional(),
    asked: AskOwnerOutput.optional(),
    answer: Answer.optional(),
    sent: SendQuoteOutput.optional(),
    recorded: UpdateDealOutput.optional(),
})

/**
 * `nivo-gtm.deals-quote` (Báo giá): the sales person fills the plan of a deal in `proposal`. The amount comes from the price-list SETTINGS (`price`), never from a model: months, the prepay discount, the
 * credit pack. A discount over the limit is refused (the run ends `price_refused`); one above the owner's line asks the owner first. The quote goes to the customer only after a person approves the send (locked). Sent: the deal is `quoted`.
 * To quote again after a refusal, change the plan back and forth: the workflow starts on the plan written.
 */
export class Quote implements Workflow<typeof State> {
    readonly key = keyOf("deals-quote")
    readonly version = 3
    readonly title = { vi: "Báo giá", en: "Quote" }
    readonly state = State
    readonly start = Open
    readonly steps = [Open, Read, Price, PriceOk, NeedsOwner, AskOwner, OwnerAnswer, OwnerOk, SendQuote, Record, Quoted, PriceRefused, OwnerSilent, Unreachable, OwnerDeclined, Declined]
}
