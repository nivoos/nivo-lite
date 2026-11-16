import { Injectable } from "@nestjs/common"
import { GenerationRunnerService } from "@modules/domain/ai-generations"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { AGENTS_QUEUE, GENERATE_JOB, type GenerateWithAgentPayload } from "@modules/queues/agents"
import { GenerateWithAgentStep } from "../../steps/generate-with-agent.step"

@Injectable()
/** The processor of the generate-with-agent job (`GENERATE_JOB`): the runner claims and settles it; `process` delegates the fenced claim to the one step. */
export class GenerateWithAgentProcessor extends FencedProcessor {
    readonly queue: "agents" = AGENTS_QUEUE

    override readonly definition: JobDefinition<GenerateWithAgentPayload> = GENERATE_JOB

    constructor(
        private readonly step: GenerateWithAgentStep,
        private readonly runner: GenerationRunnerService,
    ) {
        super()
    }

    /** Runs the step; a stale token throws the fenced-out error from the guarded write before the effect and nothing else happens. */
    async process(job: ClaimedJob): Promise<void> {
        await this.step.run(job)
    }

    /** The job was dead-lettered (one item for a person): the generation still waiting for its text is closed with the code `job_failed`; a resume reopens it. */
    override async onFailed(delivery: QueueDelivery): Promise<void> {
        await this.runner.closeOpen(delivery.payload)
    }
}
