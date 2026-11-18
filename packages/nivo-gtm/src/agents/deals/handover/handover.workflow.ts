import { z } from "zod"
import type { Workflow } from "@starci/nivoos-sdk"
import { DemoDoneData } from "../../../common/events/demo-done.event.ts"
import { keyOf } from "../../../package-key.ts"
import { BriefOutput } from "../cells/brief.cell.ts"
import { OpenDealOutput } from "../cells/open-deal.cell.ts"
import { PostBriefOutput } from "../cells/post-brief.cell.ts"
import { SetPlanOutput } from "../cells/set-plan.cell.ts"
import { Hear } from "./steps/hear.step.ts"
import { Brief } from "./steps/brief.step.ts"
import { OpenDeal } from "./steps/open-deal.step.ts"
import { PostBrief } from "./steps/post-brief.step.ts"
import { Choose } from "./steps/choose.step.ts"
import { Wants } from "./steps/wants.step.ts"
import { SetPlan } from "./steps/set-plan.step.ts"
import { Handed } from "./steps/handed.step.ts"
import { Held } from "./steps/held.step.ts"
import { Waiting } from "./steps/waiting.step.ts"

/** What the engine tells a run about the answer of a room card: who took which choice of which card. */
export const Answer = z.strictObject({
    answerKey: z.string().max(80),
    messageId: z.string().max(80),
    roomId: z.string().max(80),
    runId: z.string().max(80),
    stepKey: z.string().max(80),
    choice: z.string().max(80),
    memberId: z.string().max(80),
})
/** The salesperson's answer to the handover card (quote now or hold), as the engine reports it. */
export type Answer = z.infer<typeof Answer>
/** The `demo.done` event that starts a handover run. */
export type Demo = z.infer<typeof DemoDoneData>

/** The one state object of a run: the demo that ended, the brief, the deal opened, the card posted, the answer and the plan written. */
export const State = z.strictObject({
    event: DemoDoneData.optional(),
    brief: BriefOutput.optional(),
    deal: OpenDealOutput.optional(),
    posted: PostBriefOutput.optional(),
    answer: Answer.optional(),
    plan: SetPlanOutput.optional(),
})

/**
 * `nivo-gtm.deals-handover` (Bàn giao sau demo): a demo that ended (`nivo-gtm.demo.done`) opens a deal. The brief is written from the lead and the host's note, the deal is created in `proposal` for the next sales
 * person in turn, and a card with the brief goes to the sales room. "Báo giá" fills the deal's plan from the settings (which starts the quote workflow); "Để sau" ends it. Nothing here leaves the company.
 */
export class Handover implements Workflow<typeof State> {
    readonly key = keyOf("deals-handover")
    readonly version = 2
    readonly title = { vi: "Bàn giao sau demo", en: "Hand-over after the demo" }
    readonly state = State
    readonly start = Hear
    readonly steps = [Hear, Brief, OpenDeal, PostBrief, Choose, Wants, SetPlan, Handed, Held, Waiting]
}
