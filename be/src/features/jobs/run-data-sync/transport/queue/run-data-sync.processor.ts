import { Injectable } from "@nestjs/common"
import { DataSyncService } from "@modules/domain/data-hub"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { DATA_SYNC_QUEUE, RUN_DATA_SYNC_JOB, type DataSyncPayload } from "@modules/queues/data-sync"
import { RunDataSyncStep } from "../../steps/run-data-sync.step"

@Injectable()
/** The processor of the run-data-sync job: the runner claims and settles it; `process` delegates the fenced claim to the one step. */
export class RunDataSyncProcessor extends FencedProcessor {
    override readonly queue: "data_sync" = DATA_SYNC_QUEUE
    override readonly definition: JobDefinition<DataSyncPayload> = RUN_DATA_SYNC_JOB

    constructor(
        private readonly run: RunDataSyncStep,
        private readonly sync: DataSyncService,
    ) {
        super()
    }

    /** Runs the sync (one domain method); a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.run.run(job)
    }

    /** The job was dead-lettered (one item for a person): its run and connection say it failed so the owner stops waiting; a resume opens the run again. */
    override async onFailed(delivery: QueueDelivery, cause: unknown): Promise<void> {
        await this.sync.failed(delivery.payload, cause)
    }
}
