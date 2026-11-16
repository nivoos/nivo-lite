import { Injectable } from "@nestjs/common"
import {
    AdvancingJobStepPolicy,
    InjectJobClaims,
    type ClaimedJob,
    type JobClaims,
    type JobStep,
} from "@modules/platform/jobs"
import { DataBackupService } from "@modules/domain/data-copies"

@Injectable()
/** The one effect of the backup job: the claimed job's data set is exported once and written to its drivers. */
export class DataBackupStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly backup: DataBackupService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "backup")
    }

    /** Runs the backup after the worker's claim has been checked; a failure throws to the job runner, which judges it. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.backup.run(job)
    }
}
