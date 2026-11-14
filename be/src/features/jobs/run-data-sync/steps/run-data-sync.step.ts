import { Injectable } from "@nestjs/common"
import { DataSyncService } from "@modules/domain/data-hub"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: one connection's own system is read into the hub and its run and connection are settled. */
export class RunDataSyncStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly sync: DataSyncService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "sync")
    }

    /** Runs the sync after the worker's claim has been checked: one domain method, the job passed down. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.sync.run(job)
    }
}
