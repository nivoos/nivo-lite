import { Injectable } from "@nestjs/common"
import { ZaloCredentialsService } from "@modules/domain/channels"
import { InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the tick job: every Zalo OA whose access token ends soon gets its own renewal job, written in one transaction. */
export class FanOutRefreshStep implements JobStep {
    constructor(
        private readonly credentials: ZaloCredentialsService,
        @InjectJobClaims() private readonly claims: JobClaims,
    ) {}

    /** Records the step with the token this worker holds FIRST; then writes the renewal jobs of what is due. */
    async run(job: ClaimedJob): Promise<void> {
        await this.claims.advance({ jobId: job.jobId, expectedFencingToken: job.fencingToken, step: "fan-out" })
        await this.credentials.fanOutFromJob(job.payload)
    }
}
