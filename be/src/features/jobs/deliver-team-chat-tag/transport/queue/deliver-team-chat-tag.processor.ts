import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { DELIVER_TEAM_CHAT_TAG_JOB, TEAM_CHAT_TAG_QUEUE, type TeamChatTagPayload } from "@modules/queues/team-chat-tag"
import { DeliverTagStep } from "../../steps/deliver-tag.step"

/** How many tags one process delivers at once: each is its own event under its own once-key, so they do not wait on each other. */
const DELIVER_CONCURRENCY = 4

@Injectable()
/** The processor of the deliver job of the team-chat-tag queue: the runner claims and settles it; `process` delegates to the one step. */
export class DeliverTeamChatTagProcessor extends FencedProcessor {
    override readonly queue: "team_chat_tag" = TEAM_CHAT_TAG_QUEUE

    override readonly definition: JobDefinition<TeamChatTagPayload> = DELIVER_TEAM_CHAT_TAG_JOB

    override readonly concurrency: 4 = DELIVER_CONCURRENCY

    constructor(private readonly deliver: DeliverTagStep) {
        super()
    }

    /** Runs the step; a stale token throws the fenced-out error from the guarded write before the effect and nothing else happens. */
    async process(job: ClaimedJob): Promise<void> {
        await this.deliver.run(job)
    }
}
