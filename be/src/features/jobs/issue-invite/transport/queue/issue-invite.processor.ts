import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { INVITE_COMMAND_QUEUE, ISSUE_INVITE_JOB, type InviteCommandPayload } from "@modules/queues/invite-command"
import { IssueInviteStep } from "../../steps/issue-invite.step"

@Injectable()
/** The processor of the issue-invite job: the runner claims and settles it; `process` delegates to the one step. */
export class IssueInviteProcessor extends FencedProcessor {
    override readonly queue: "invite_command" = INVITE_COMMAND_QUEUE
    override readonly definition: JobDefinition<InviteCommandPayload> = ISSUE_INVITE_JOB

    constructor(private readonly issue: IssueInviteStep) {
        super()
    }

    /** Serves the invitation command; a stale token throws the fenced-out error from the guarded write before the effect and nothing else happens. */
    async process(job: ClaimedJob): Promise<void> {
        await this.issue.run(job)
    }

    /** The job was dead-lettered (one item for a person): the command says the work stopped; a resume re-opens it. */
    override async onFailed(delivery: QueueDelivery): Promise<void> {
        await this.issue.stopped(delivery.payload)
    }
}
