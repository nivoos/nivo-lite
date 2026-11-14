import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { REFRESH_ZALO_TOKENS_JOB, ZALO_REFRESH_QUEUE, type ZaloRefreshPayload } from "@modules/queues/zalo-refresh"
import { FanOutRefreshStep } from "../../steps/fan-out-refresh.step"

@Injectable()
/** The processor of the refresh tick: every scheduler tick writes one renewal job per due connection. A failure throws: the runner classifies it. */
export class RefreshZaloTokensProcessor extends FencedProcessor {
    override readonly queue: "zalo_refresh" = ZALO_REFRESH_QUEUE
    override readonly definition: JobDefinition<ZaloRefreshPayload> = REFRESH_ZALO_TOKENS_JOB

    constructor(private readonly fanOut: FanOutRefreshStep) {
        super()
    }

    /** Fans the due tokens out; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.fanOut.run(job)
    }
}
