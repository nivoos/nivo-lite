import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { REFRESH_ZALO_CONNECTION_JOB, ZALO_REFRESH_QUEUE, type ZaloRefreshConnectionPayload } from "@modules/queues/zalo-refresh"
import { RenewConnectionStep } from "../../steps/renew-connection.step"

@Injectable()
/**
 * The processor of one connection's renewal. A failure throws: a transient one (Zalo unreachable, the lease busy) is retried on the
 * background ladder, a refusal parks with one item. The connection already reads failing when Zalo refused its refresh token.
 */
export class RefreshZaloConnectionProcessor extends FencedProcessor {
    override readonly queue: "zalo_refresh" = ZALO_REFRESH_QUEUE
    override readonly definition: JobDefinition<ZaloRefreshConnectionPayload> = REFRESH_ZALO_CONNECTION_JOB

    constructor(private readonly renew: RenewConnectionStep) {
        super()
    }

    /** Renews the connection; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.renew.run(job)
    }
}
