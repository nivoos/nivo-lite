import { Injectable } from "@nestjs/common"
import { RecordEventDeliveryService } from "@modules/domain/record-events"
import { AdvancingJobStepPolicy, InjectJobClaims, type ClaimedJob, type JobClaims, type JobStep } from "@modules/platform/jobs"

@Injectable()
/** The one effect of the job: the record write the job names is handed to the one event pipeline, in the api (the one app that drives runs). */
export class DeliverRecordWriteStep extends AdvancingJobStepPolicy implements JobStep {
    constructor(
        private readonly writes: RecordEventDeliveryService,
        @InjectJobClaims() claims: JobClaims,
    ) {
        super(claims, "deliver")
    }

    /** Delivers the write after the worker's claim has been checked. */
    protected perform(_payload: object, job: ClaimedJob): Promise<unknown> {
        return this.writes.deliverJob(job)
    }
}
