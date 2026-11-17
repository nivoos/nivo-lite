import type { Agent } from "@starci/nivoos-sdk"
import { SepayNivo } from "../../accounts/sepay-nivo.account.ts"
import { TelegramTeam } from "../../accounts/telegram-team.account.ts"
import { keyOf } from "../../package-key.ts"
import { Activate } from "./activate/activate.workflow.ts"
import { Welcome } from "./activate/steps/welcome.step.ts"
import { Handover } from "./handover/handover.workflow.ts"
import { LostReview } from "./lost-review/lost-review.workflow.ts"
import { PayWatch } from "./pay-watch/pay-watch.workflow.ts"
import { Nudge } from "./pay/steps/nudge.step.ts"
import { SendPay } from "./pay/steps/send-pay.step.ts"
import { Pay } from "./pay/pay.workflow.ts"
import { SendQuote } from "./quote/steps/send-quote.step.ts"
import { Quote } from "./quote/quote.workflow.ts"

/**
 * `nivo-gtm.deals`: Chốt đơn (accountable person: the sales person on each deal). Handover after a demo, quote from the price-list settings, the SePay pay code and match, the activation as a person's step and
 * the Friday lost-deals review. Every step that sends a line to a customer is `ask` (and the engine locks it: it may not be switched to `auto`).
 */
export class Deals implements Agent {
    readonly key = keyOf("deals")
    readonly version = 2
    readonly title = { vi: "Chốt đơn", en: "Deals" }
    readonly workflows = [Handover, Quote, Pay, PayWatch, Activate, LostReview]
    readonly providers = [TelegramTeam, SepayNivo]
    readonly settings = [
        { workflow: Quote, step: SendQuote, mode: "ask" },
        { workflow: Pay, step: SendPay, mode: "ask" },
        { workflow: Pay, step: Nudge, mode: "ask" },
        { workflow: Activate, step: Welcome, mode: "ask" },
    ] as const
}
