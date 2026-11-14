import { Injectable } from "@nestjs/common"
import { ZaloCredentialsService } from "@modules/domain/channels"
import { InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the renewal job: one Zalo OA gets a new token pair, which also keeps the 3-month refresh token rolling. */
export class RenewConnectionStep implements JobStep {
    constructor(
        private readonly credentials: ZaloCredentialsService,
        @InjectJobClaims() private readonly claims: JobClaims,
    ) {}

    /** Records the step with the token this worker holds FIRST; then renews the connection the payload names. */
    async run(job: ClaimedJob): Promise<void> {
        await this.claims.advance({ jobId: job.jobId, expectedFencingToken: job.fencingToken, step: "renew" })
        await this.credentials.renewFromJob(job.payload)
    }
}
