import { Injectable } from "@nestjs/common"
import { DossierReviewRunnerService } from "@modules/domain/dossier-review"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: the review run of the claimed job is carried out. */
export class ReviewDossiersStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        @InjectJobClaims() claims: JobClaims,
        private readonly runner: DossierReviewRunnerService,
    ) {
        super(claims, "review")
    }

    /** Runs the review after the worker's claim has been checked. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.runner.run(job)
    }
}
