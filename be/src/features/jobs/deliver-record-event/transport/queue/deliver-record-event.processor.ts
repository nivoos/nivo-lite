import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_RECORD_EVENT_JOB, RECORD_EVENTS_QUEUE, type RecordEventPayload } from "@modules/queues/record-events"
import { DeliverRecordWriteStep } from "../../steps/deliver-record-write.step"

/** How many writes one process delivers at once: each is its own event under its own once-key. */
const DELIVER_CONCURRENCY = 4

@Injectable()
/** The processor of the deliver job of the record-events queue: the runner claims and settles it; `process` delegates to the one step. */
export class DeliverRecordEventProcessor extends FencedProcessor {
    override readonly queue: "record_events" = RECORD_EVENTS_QUEUE

    override readonly definition: JobDefinition<RecordEventPayload> = DELIVER_RECORD_EVENT_JOB

    override readonly concurrency: 4 = DELIVER_CONCURRENCY

    constructor(private readonly deliver: DeliverRecordWriteStep) {
        super()
    }

    /** Runs the step; a stale token throws the fenced-out error from the guarded write before the effect and nothing else happens. */
    async process(job: ClaimedJob): Promise<void> {
        await this.deliver.run(job)
    }
}
