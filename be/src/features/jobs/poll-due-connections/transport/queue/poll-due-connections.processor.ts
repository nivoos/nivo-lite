import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { CONNECTION_POLL_QUEUE, POLL_DUE_JOB, type ConnectionPollTick } from "@modules/queues/connection-poll"
import { PollDueStep } from "../../steps/poll-due.step"

@Injectable()
/** The processor of the poll-due-connections job: every scheduler tick runs the one step. A connection's failed read is planned by the provider's declared schedule; anything else that throws is judged by the runner. */
export class PollDueConnectionsProcessor extends FencedProcessor {
    override readonly queue: "connection-poll" = CONNECTION_POLL_QUEUE
    override readonly definition: JobDefinition<ConnectionPollTick> = POLL_DUE_JOB

    constructor(private readonly pollDue: PollDueStep) {
        super()
    }

    /** Polls what is due; a stale token throws the fenced-out error from the guarded write before the effect. */
    async process(job: ClaimedJob): Promise<void> {
        await this.pollDue.run(job)
    }
}
