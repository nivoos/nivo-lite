import { Injectable } from "@nestjs/common"
import { FencedProcessor, type ClaimedJob, type JobDefinition } from "@modules/platform/jobs"
import { ROUTE_TEAM_CHAT_MESSAGE_JOB, TEAM_CHAT_TAG_QUEUE, type TeamChatRoutePayload } from "@modules/queues/team-chat-tag"
import { RouteMessageStep } from "../../steps/route-message.step"

/** How many messages one process routes at once: each is its own job under its own once-key, so they do not wait on each other. */
const ROUTE_CONCURRENCY = 4

@Injectable()
/** The processor of the route job of the team-chat-tag queue: the runner claims and settles it; `process` delegates to the one step. */
export class RouteTeamChatMessageProcessor extends FencedProcessor {
    override readonly queue: "team_chat_tag" = TEAM_CHAT_TAG_QUEUE

    override readonly definition: JobDefinition<TeamChatRoutePayload> = ROUTE_TEAM_CHAT_MESSAGE_JOB

    override readonly concurrency: 4 = ROUTE_CONCURRENCY

    constructor(private readonly route: RouteMessageStep) {
        super()
    }

    /** Runs the step; a stale token throws the fenced-out error from the guarded write before the effect and nothing else happens. */
    async process(job: ClaimedJob): Promise<void> {
        await this.route.run(job)
    }
}
