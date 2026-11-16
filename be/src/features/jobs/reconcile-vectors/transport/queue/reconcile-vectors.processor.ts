import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { RECONCILE_VECTORS_JOB, VECTOR_SYNC_QUEUE, type VectorReconcilePayload } from "@modules/queues/vector-sync"
import { ReconcileRunStep } from "../../steps/reconcile-run.step"

@Injectable()
/** The processor of the reconcile-vectors job (the tick `vector-reconcile` and the follow-up of a run that used its budget): the runner claims and settles it; `process` delegates to the one step. A failure of the index or of an embedding call throws: the runner retries the run on its ladder and dead-letters it with one item. */
export class ReconcileVectorsProcessor extends FencedProcessor {
    override readonly queue: "vector_sync" = VECTOR_SYNC_QUEUE
    override readonly definition: JobDefinition<VectorReconcilePayload> = RECONCILE_VECTORS_JOB

    constructor(private readonly step: ReconcileRunStep) {
        super()
    }

    /** Runs the one step; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.step.run(job)
    }
}
