import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { AGENT_SCHEDULE_FIRE_QUEUE, FIRE_AGENT_SCHEDULE_JOB, type AgentScheduleFirePayload } from "@modules/queues/agent-turn"
import { FireStep } from "../../steps/fire.step"

@Injectable()
/** The processor of the fire queue: every slot of every trigger comes here; the runner claims and settles it and `process` delegates to the one step. A failure throws: the runner retries a transient one on the broker's tries and dead-letters the rest with one item. */
export class FireAgentScheduleProcessor extends FencedProcessor {
    override readonly queue: "agent_schedule_fire" = AGENT_SCHEDULE_FIRE_QUEUE
    override readonly definition: JobDefinition<AgentScheduleFirePayload> = FIRE_AGENT_SCHEDULE_JOB

    /** The jobs of this queue come from the job schedulers of the trigger rows, so the worker skips the admission against the outbox. */
    override readonly scheduled = true

    constructor(private readonly fire: FireStep) {
        super()
    }

    /** Runs the step; a stale token throws the fenced-out error from the guarded write before the effect and nothing else happens. */
    async process(job: ClaimedJob): Promise<void> {
        await this.fire.run(job)
    }
}
