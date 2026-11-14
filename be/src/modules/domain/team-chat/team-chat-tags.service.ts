import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AgentOwnershipService } from "@modules/domain/agents"
import { InjectQueueOutbox, type QueueOutbox } from "@modules/platform/queue"
import {
    DELIVER_TEAM_CHAT_TAG_JOB,
    ROUTE_TEAM_CHAT_MESSAGE_JOB,
    TEAM_CHAT_TAG_QUEUE,
    TeamChatTagJob,
    type TeamChatRoutePayload,
    type TeamChatTagPayload,
} from "@modules/queues/team-chat-tag"
import type { TeamChatRoute, TeamChatTag, TeamChatTags } from "./team-chat.port"

@Injectable()
/**
 * The tag a person writes in the team chat: `@agent` in a message hands the text to that agent. The person must be allowed to hand work to
 * the agent (its roles and rooms). A stored message is first routed by its own job, written in the message's transaction (the turn router
 * decides which agents it took); the tag is then queued once per (message, agent) in the transaction that finishes the route job, for the
 * api, which delivers it through the one event pipeline (`TeamChatTagDeliveryService`): the app the message was posted in (the api, or the mcp gateway) composes no delivery and drives
 * no run (R24). The chat never calls the agent itself, the answer comes back as a report.
 */
export class TeamChatTagsService implements TeamChatTags {
    constructor(
        @InjectQueueOutbox() private readonly outbox: QueueOutbox,
        private readonly ownership: AgentOwnershipService,
    ) {}

    /** Writes the route job of a stored message in the caller's transaction; a repeat is the same job. */
    async queueRoute(tx: EntityManager, route: TeamChatRoute): Promise<void> {
        const payload: TeamChatRoutePayload = route
        await this.outbox.write(tx, TEAM_CHAT_TAG_QUEUE, payload, {
            job: TeamChatTagJob.Route,
            dedupeKey: ROUTE_TEAM_CHAT_MESSAGE_JOB.onceKey(payload),
        })
    }

    /** Queues the tag of one message for one agent in the caller's transaction; false when the person may not hand work to it. A repeat is the same job. */
    async handOff(tx: EntityManager, workspaceId: string, tag: TeamChatTag): Promise<boolean> {
        const personId = await this.ownership.memberIdOf(tag.userId, workspaceId)
        if (!(await this.ownership.canAssign(personId, tag.agentId))) return false
        const payload: TeamChatTagPayload = {
            workspaceId,
            agentId: tag.agentId,
            memberId: personId,
            roomId: tag.roomId,
            messageId: tag.messageId,
            text: tag.text,
        }
        await this.outbox.write(tx, TEAM_CHAT_TAG_QUEUE, payload, {
            job: TeamChatTagJob.Deliver,
            dedupeKey: DELIVER_TEAM_CHAT_TAG_JOB.onceKey(payload),
        })
        return true
    }
}
