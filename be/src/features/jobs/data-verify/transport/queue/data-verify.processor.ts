import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DATA_COPIES_QUEUE, VERIFY_DATA_JOB, type DataCopiesTickPayload } from "@modules/queues/data-copies"
import { DataVerifyStep } from "../../steps/data-verify.step"

@Injectable()
/** The processor of the daily verify: the runner claims and settles it; `process` delegates to the one step. A copy that is unhealthy or differs is a dead letter with ONE item for a person; a driver that cannot be reached is retried on the background ladder. */
export class DataVerifyProcessor extends FencedProcessor {
    override readonly queue: "data_copies" = DATA_COPIES_QUEUE
    override readonly definition: JobDefinition<DataCopiesTickPayload> = VERIFY_DATA_JOB

    constructor(private readonly verify: DataVerifyStep) {
        super()
    }

    /** Runs the one step; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.verify.run(job)
    }
}
