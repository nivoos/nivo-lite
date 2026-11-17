// The entry of the nivo-gtm package: `nivoos package build src/nivo-gtm.package.ts --out seed` type-checks it and writes seed/nivo-gtm@<version>.json.
// One class per cell, per event kind, per brain document, per object type, per workspace, per agent and per workflow; the agents and their workflows are nested in the workspace class.
// The channel providers (Telegram, SePay, Google) are the catalogue's (provider-templates): this package carries none.
import type { Package } from "@starci/nivoos-sdk"
import { NivoGtmWorkspace } from "./nivo-gtm.workspace.ts"
import { CutReady } from "./common/events/cut-ready.event.ts"
import { ContentApproved } from "./common/events/content-approved.event.ts"
import { ContentPublished } from "./common/events/content-published.event.ts"
import { LeadSignal } from "./common/events/lead-signal.event.ts"
import { LeadReady } from "./common/events/lead-ready.event.ts"
import { LeadQualified } from "./common/events/lead-qualified.event.ts"
import { DemoDone } from "./common/events/demo-done.event.ts"
import { DealPaid } from "./common/events/deal-paid.event.ts"
import { PayRequested } from "./common/events/pay-requested.event.ts"
import { ParkAlert } from "./common/recover/park-alert.cell.ts"
import { PostCard } from "./common/recover/post-card.cell.ts"
import { RetryDecision } from "./common/recover/retry-decision.cell.ts"
import { ReadDeal } from "./agents/deals/cells/read-deal.cell.ts"
import { Brief } from "./agents/deals/cells/brief.cell.ts"
import { OpenDeal } from "./agents/deals/cells/open-deal.cell.ts"
import { PostBrief } from "./agents/deals/cells/post-brief.cell.ts"
import { SetPlan } from "./agents/deals/cells/set-plan.cell.ts"
import { Price } from "./agents/deals/cells/price.cell.ts"
import { AskOwner } from "./agents/deals/cells/ask-owner.cell.ts"
import { SendQuote } from "./agents/deals/cells/send-quote.cell.ts"
import { UpdateDeal } from "./agents/deals/cells/update-deal.cell.ts"
import { UpdateLead } from "./agents/deals/cells/update-lead.cell.ts"
import { SendPay } from "./agents/deals/cells/send-pay.cell.ts"
import { EmitPayRequested } from "./agents/deals/cells/emit-pay-requested.cell.ts"
import { CheckAmount } from "./agents/deals/cells/check-amount.cell.ts"
import { EmitDealPaid } from "./agents/deals/cells/emit-deal-paid.cell.ts"
import { RequestActivation } from "./agents/deals/cells/request-activation.cell.ts"
import { SendWelcome } from "./agents/deals/cells/send-welcome.cell.ts"
import { LostWeek } from "./agents/deals/cells/lost-week.cell.ts"
import { LostSummary } from "./agents/deals/cells/lost-summary.cell.ts"
import { PACKAGE_KEY } from "./package-key.ts"

export default {
    package: { key: PACKAGE_KEY, version: "0.1.0", author: "nivo-lite" },
    cells: [CutReady, ContentApproved, ContentPublished, LeadSignal, LeadReady, LeadQualified, DemoDone, DealPaid, PayRequested, PostCard, ParkAlert, RetryDecision,
        ReadDeal, Brief, OpenDeal, PostBrief, SetPlan, Price, AskOwner, SendQuote, UpdateDeal, UpdateLead, SendPay, EmitPayRequested, CheckAmount, EmitDealPaid, RequestActivation, SendWelcome, LostWeek, LostSummary],
    workspaces: [NivoGtmWorkspace],
} satisfies Package
