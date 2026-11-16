import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { SYSTEM_HISTORY_RETENTION_QUEUE, SWEEP_SYSTEM_HISTORY_JOB, type SystemHistorySweepPayload } from "@modules/queues/system-history-retention"
import { SweepSystemHistoryStep } from "../../steps/sweep-system-history.step"

@Injectable()
/** The processor of the sweep-system-history job: the runner claims and settles every end-of-day tick; `process` delegates to the one step. */
export class SweepSystemHistoryProcessor extends FencedProcessor {
    override readonly queue: "system_history_retention" = SYSTEM_HISTORY_RETENTION_QUEUE
    override readonly definition: JobDefinition<SystemHistorySweepPayload> = SWEEP_SYSTEM_HISTORY_JOB

    constructor(private readonly sweep: SweepSystemHistoryStep) {
        super()
    }

    /** Sweeps the finished history; a stale token throws the fenced-out error from the guarded write before a batch. */
    async process(job: ClaimedJob): Promise<void> {
        await this.sweep.run(job)
    }
}
