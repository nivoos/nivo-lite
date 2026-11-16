import { Injectable } from "@nestjs/common"
import { AdvancingJobStepPolicy, InjectJobClaims, type JobClaims, type JobStep } from "@modules/platform/jobs"
import { DataBackupDueService } from "@modules/domain/data-copies"

@Injectable()
/** The one effect of the hourly tick: every backup data set gets its backup job for the current slot. */
export class BackupDueStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly due: DataBackupDueService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "queue-due")
    }

    /** Queues the due backups after the worker's claim has been checked. */
    protected perform(): Promise<unknown> {
        return this.due.queueDue()
    }
}
