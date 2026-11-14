import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { SYNC_VECTORS_JOB, VECTOR_SYNC_QUEUE, type VectorSyncPayload } from "@modules/queues/vector-sync"
import { SyncRowsStep } from "../../steps/sync-rows.step"

/** The workspace headroom of a sync job: above the truths work's limit and its one fair extra slot. */
const SYNC_WORKSPACE_HEADROOM = 3

@Injectable()
/** The processor of the sync-vectors job: the runner claims and settles it; `process` delegates to the one step. A failure of the vector index or of an embedding call throws: the runner retries the job on its ladder and dead-letters it with one item. */
export class SyncVectorsProcessor extends FencedProcessor {
    override readonly queue: "vector_sync" = VECTOR_SYNC_QUEUE
    override readonly definition: JobDefinition<VectorSyncPayload> = SYNC_VECTORS_JOB
    /**
     * A sync job is short (a read, at most a few embedding calls, an upsert): it starts while the workspace runs up to this many jobs
     * beyond its limit, so the truths work of the workspace never holds the vectors back (brain walk 3, D-R-9: waits up to 24 min).
     */
    override readonly workspaceHeadroom: number = SYNC_WORKSPACE_HEADROOM

    constructor(private readonly step: SyncRowsStep) {
        super()
    }

    /** Runs the one step; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.step.run(job)
    }
}
