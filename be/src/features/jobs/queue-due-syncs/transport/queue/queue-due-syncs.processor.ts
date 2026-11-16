import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DATA_SYNC_QUEUE, QUEUE_DUE_SYNCS_JOB, type DataSyncTickPayload } from "@modules/queues/data-sync"
import { QueueDueSyncsStep } from "../../steps/queue-due-syncs.step"

@Injectable()
/** The processor of the minute tick of the data-sync queue: it queues the syncs that are due; a failure throws and the runner decides. */
export class QueueDueSyncsProcessor extends FencedProcessor {
    override readonly queue: "data_sync" = DATA_SYNC_QUEUE
    override readonly definition: JobDefinition<DataSyncTickPayload> = QUEUE_DUE_SYNCS_JOB

    constructor(private readonly queueDue: QueueDueSyncsStep) {
        super()
    }

    /** Queues the due syncs; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.queueDue.run(job)
    }
}
