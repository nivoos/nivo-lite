import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DECISIONS_QUEUE, WATCH_AGENT_GRAPHS_JOB, type AgentGraphWatchPayload } from "@modules/queues/decisions"
import { WatchAgentGraphsStep } from "../../steps/watch-agent-graphs.step"

@Injectable()
/** The processor of the graphs tick of the decisions queue: the runner claims and settles it; `process` delegates to the one step. A failure throws: the runner retries a transient one and dead-letters the rest with one item. */
export class WatchAgentGraphsProcessor extends FencedProcessor {
    override readonly queue: "decisions" = DECISIONS_QUEUE
    override readonly definition: JobDefinition<AgentGraphWatchPayload> = WATCH_AGENT_GRAPHS_JOB

    constructor(private readonly step: WatchAgentGraphsStep) {
        super()
    }

    /** Runs the step; a stale token throws the fenced-out error from the guarded write before the effect and nothing else happens. */
    async process(job: ClaimedJob): Promise<void> {
        await this.step.run(job)
    }
}
