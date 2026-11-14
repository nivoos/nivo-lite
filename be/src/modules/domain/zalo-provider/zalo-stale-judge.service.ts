import { Injectable } from "@nestjs/common"
import { InjectZaloProviderOptions } from "./zalo-provider.decorators"
import type { ZaloProviderOptions } from "./zalo-provider.options"
import { isStaleMessage, pollRulesOf, type ZaloPollRules } from "./zalo-poll.policy"

@Injectable()
/**
 * Zalo's own rule for a message an agent must not answer (older than the reply window or the stale age, whichever is shorter), with the
 * app's options applied. It judges against a clock the CALLER reads: the poll receiver reads the provider only, so the judgement is made
 * by the admission of the `zalo_oa.event` row, at the moment the row is new.
 */
export class ZaloStaleJudgeService {
    private readonly rules: ZaloPollRules

    constructor(@InjectZaloProviderOptions() options: ZaloProviderOptions) {
        this.rules = pollRulesOf(options)
    }

    /** True when a message sent at `sentAt` (epoch milliseconds) is too old to answer at `now` (epoch milliseconds). */
    isStale(sentAt: number, now: number): boolean {
        return isStaleMessage(sentAt, now, this.rules)
    }
}
