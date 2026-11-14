import { Injectable } from "@nestjs/common"
import { DataSyncService } from "@modules/domain/data-hub"
import { AdvancingJobStepPolicy, InjectJobClaims, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the minute tick: the scheduled syncs that are due get a run and a job. */
export class QueueDueSyncsStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly sync: DataSyncService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "queue-due")
    }

    /** Queues the due syncs after the worker's claim has been checked. */
    protected perform(): Promise<unknown> {
        return this.sync.queueDue()
    }
}
