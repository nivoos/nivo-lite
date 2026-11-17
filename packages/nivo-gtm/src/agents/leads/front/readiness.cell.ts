import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { LeadIntent } from "./understand.cell.ts"

export const ReadinessInput = z.strictObject({ intent: LeadIntent, stage: z.string().max(30), turns: z.number().int().nonnegative() })
export const ReadinessOutput = z.strictObject({ ready: z.boolean(), reason: z.string().min(1).max(200) })
/** The business rule: how many touches a lead has before it is scored even without asking for a demo or a price. */
export const ReadinessSettings = z.strictObject({ minTurns: z.number().int().min(1).max(50).default(3) })

type In = z.infer<typeof ReadinessInput>
type Out = z.infer<typeof ReadinessOutput>
type Settings = z.infer<typeof ReadinessSettings>

/**
 * Decides whether the lead is ready to be scored (and so, if it fits, offered a demo): it asked for a demo or a price, or it has been touched `minTurns` times. A lead that has a demo booked,
 * or is won, lost, unfit or cold-and-silent, is not. A decision node: no act, no read.
 */
export class Readiness implements Node<typeof ReadinessInput, typeof ReadinessOutput, typeof ReadinessSettings> {
    readonly key = keyOf("leads-readiness")
    readonly version = 1
    readonly title = { vi: "Khách đã sẵn sàng chưa", en: "Is the lead ready" }
    readonly input = ReadinessInput
    readonly output = ReadinessOutput
    readonly settings = ReadinessSettings
    readonly reads = []

    run(input: In, reach: NodeReach<Settings>): Out {
        const open = input.stage === "new" || input.stage === "engaged" || input.stage === "qualified"
        if (!open) return { ready: false, reason: "stage_closed" }
        if (input.intent === "wants_demo") return { ready: true, reason: "Khách xin xem demo" }
        if (input.intent === "asks_price") return { ready: true, reason: "Khách hỏi giá" }
        if (input.turns >= reach.settings.minTurns) return { ready: true, reason: `Đã trao đổi ${input.turns} lần` }
        return { ready: false, reason: "too_early" }
    }
}
