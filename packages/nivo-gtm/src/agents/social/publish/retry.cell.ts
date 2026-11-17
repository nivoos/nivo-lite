import { z } from "zod"
import type { Node, NodeReach } from "@starci/nivoos-sdk"
import { keyOf } from "../../../package-key.ts"
import { addHours } from "../common/helpers.ts"

export const RetryInput = z.strictObject({ attempt: z.number().int().min(0).max(100), refusal: z.string().max(80) })
export const RetryOutput = z.strictObject({ again: z.boolean(), attempt: z.number().int(), retryAt: z.string() })
/** The recovery caps: 3 retries, 15 minutes apart. A refusal that no retry mends (`channel_pending`, `channel_not_set`) is never retried. */
export const RetrySettings = z.strictObject({
    retries: z.number().int().min(0).max(20).default(3),
    retryMinutes: z.number().int().min(1).max(1440).default(15),
})

type In = z.infer<typeof RetryInput>
type Out = z.infer<typeof RetryOutput>
type Settings = z.infer<typeof RetrySettings>

/**
 * `nivo-gtm.social-retry` (Thử lại hay dừng): the retry half of the recovery rule, pure logic. After a refusal of the send it says whether to wait and try again (fewer than `retries` attempts made, and a refusal a retry can mend)
 * and when (`retryAt`, `retryMinutes` from now); else the workflow parks the publication.
 */
export class SocialRetry implements Node<typeof RetryInput, typeof RetryOutput, typeof RetrySettings> {
    readonly key = keyOf("social-retry")
    readonly version = 1
    readonly title = { vi: "Thử lại hay dừng", en: "Retry or park" }
    readonly input = RetryInput
    readonly output = RetryOutput
    readonly settings = RetrySettings
    readonly reads = []

    run(input: In, reach: NodeReach<Settings>): Out {
        const mendable = input.refusal !== "channel_pending" && input.refusal !== "channel_not_set"
        return { again: mendable && input.attempt < reach.settings.retries, attempt: input.attempt + 1, retryAt: addHours(reach.facts.at, reach.settings.retryMinutes / 60) }
    }
}
