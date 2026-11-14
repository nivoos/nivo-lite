import { Injectable } from "@nestjs/common"
import {
    AdvancingJobStepPolicy,
    InjectJobClaims,
    type ClaimedJob,
    type JobClaims,
    type JobStep,
} from "@modules/platform/jobs"
import { DataVerifyService } from "@modules/domain/data-copies"

@Injectable()
/** The one effect of the verify job: the newest copy of every backup data set is verified and restored into scratch. */
export class DataVerifyStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly verify: DataVerifyService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "verify")
    }

    /** Runs the verify after the worker's claim has been checked; a finding throws to the job runner, which parks it with one item for a person. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.verify.run(job)
    }
}
