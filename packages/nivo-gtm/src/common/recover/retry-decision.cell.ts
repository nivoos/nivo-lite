import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../package-key.ts"

export const RetryDecisionInput = z.strictObject({ attempt: z.number().int().min(0).max(100) })
export const RetryDecisionOutput = z.strictObject({ again: z.boolean(), attempt: z.number().int(), waitMinutes: z.number().int() })
/** The caps of the recovery rule, as per-customer settings with defaults: 3 retries, 15 minutes apart. */
export const RetryDecisionSettings = z.strictObject({
    retries: z.number().int().min(0).max(20).default(3),
    retryMinutes: z.number().int().min(1).max(1440).default(15),
})

type In = z.infer<typeof RetryDecisionInput>
type Out = z.infer<typeof RetryDecisionOutput>
type Settings = z.infer<typeof RetryDecisionSettings>

/**
 * `nivo-gtm.retry-decision` (Thử lại hay dừng): the retry half of the recovery rule, pure logic. After a refusal the author can act on (`unavailable`, `account_not_active`, a rate refusal) a workflow
 * asks this cell: `again` is true while the attempts made are fewer than `retries`; the workflow then waits `waitMinutes` (its retry-wait step) and tries again, else it parks (`park-alert`).
 */
export class RetryDecision implements Node<typeof RetryDecisionInput, typeof RetryDecisionOutput, typeof RetryDecisionSettings> {
    readonly key = keyOf("retry-decision")
    readonly version = 1
    readonly title = { vi: "Thử lại hay dừng", en: "Retry or park" }
    readonly input = RetryDecisionInput
    readonly output = RetryDecisionOutput
    readonly settings = RetryDecisionSettings
    readonly reads = []

    run(input: In, reach: NodeReach<Settings>): Out {
        return { again: input.attempt < reach.settings.retries, attempt: input.attempt + 1, waitMinutes: reach.settings.retryMinutes }
    }
}
