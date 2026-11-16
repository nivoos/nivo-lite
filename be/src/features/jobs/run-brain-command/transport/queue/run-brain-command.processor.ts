import { Injectable } from "@nestjs/common"
import { BrainCommandRunnerService } from "@modules/domain/brain"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { KNOWLEDGE_QUEUE, RUN_BRAIN_COMMAND_JOB, type BrainJobPayload } from "@modules/queues/knowledge"
import { RunCommandStep } from "../../steps/run-command.step"

@Injectable()
/** The processor of the run-brain-command job (`RUN_BRAIN_COMMAND_JOB`): the runner claims and settles it; `process` delegates to the one step. */
export class RunBrainCommandProcessor extends FencedProcessor {
    override readonly queue: "knowledge" = KNOWLEDGE_QUEUE
    override readonly definition: JobDefinition<BrainJobPayload> = RUN_BRAIN_COMMAND_JOB

    constructor(
        private readonly runCommand: RunCommandStep,
        private readonly runner: BrainCommandRunnerService,
    ) {
        super()
    }

    /** Carries out the command; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.runCommand.run(job)
    }

    /** The job was dead-lettered (one item for a person): the command row says it did not run; a resume opens it again. */
    override async onFailed(delivery: QueueDelivery): Promise<void> {
        await this.runner.giveUp(delivery.payload)
    }
}
