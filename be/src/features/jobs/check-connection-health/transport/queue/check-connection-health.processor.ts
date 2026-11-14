import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import {
    CHECK_CONNECTION_HEALTH_JOB,
    CONNECTION_HEALTH_QUEUE,
    type ConnectionHealthPayload,
} from "@modules/queues/connection-health"
import { JudgeConnectionsStep } from "../../steps/judge-connections.step"

@Injectable()
/** The processor of the check-connection-health job: every scheduler tick runs the one step. A failure throws: the runner retries a transient one on the background ladder and parks the rest with one item. */
export class CheckConnectionHealthProcessor extends FencedProcessor {
    override readonly queue: "connection_health" = CONNECTION_HEALTH_QUEUE
    override readonly definition: JobDefinition<ConnectionHealthPayload> = CHECK_CONNECTION_HEALTH_JOB

    constructor(private readonly judge: JudgeConnectionsStep) {
        super()
    }

    /** Judges the connections; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.judge.run(job)
    }
}
