import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { eachInOrder } from "@modules/platform/primitives"
import { isTeamChatRoutePayload } from "@modules/queues/team-chat-tag"
import { InjectTeamChatTags } from "./team-chat.decorators"
import type { PersonLineHeard } from "./team-chat-lines.contracts"
import type { TeamChatTags } from "./team-chat.port"
import { TeamChatRoomsService } from "./team-chat.service"
import { TeamChatStoreService } from "./team-chat-store.service"

@Injectable()
/**
 * THE ROUTE OF A STORED MESSAGE, run by the api only (the one app that drives runs; R24): the job the message's own transaction wrote.
 * It reads the message back, asks the turn router which agents it started a turn for, and writes the tag job of each other agent the
 * message names in ONE transaction (the one that finishes the job), so a process that dies at any step finishes it from the stored
 * message: the router answers an agent it already started as taken, and the tag jobs are keyed once per (message, agent). NOT provided
 * by the team chat module: only the api's job module composes it.
 */
export class TeamChatRouteService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        private readonly store: TeamChatStoreService,
        private readonly rooms: TeamChatRoomsService,
        @InjectTeamChatTags() private readonly tags: TeamChatTags,
    ) {}

    /** Routes the message a job names; a payload that is no route, a message or a room that is gone ends the job doing nothing. */
    async routeJob(payload: object): Promise<void> {
        if (!isTeamChatRoutePayload(payload)) return
        const { workspaceId, userId } = payload
        const [message] = await this.store.messagesByIds(workspaceId, [payload.messageId])
        if (message?.roomId !== payload.roomId) return
        const room = await this.store.roomById(workspaceId, message.roomId)
        if (room === null) return
        const repliedTo = message.replyTo === null ? null : await this.store.messageIn(workspaceId, room.id, message.replyTo)
        const agentMentions = message.mentions.filter((mention) => mention.kind === "agent").map((mention) => mention.id)
        const line: PersonLineHeard = {
            workspaceId,
            userId,
            room: { id: room.id, kind: room.kind, directKey: room.directKey },
            message: { id: message.id, body: message.body, createdAt: message.createdAt.toISOString() },
            agentMentions,
            repliedTo:
                repliedTo === null
                    ? null
                    : {
                          id: repliedTo.id,
                          authorKind: repliedTo.authorKind,
                          authorId: repliedTo.authorId,
                          kind: repliedTo.kind,
                          agentMessage: repliedTo.ref?.agent_message ?? null,
                          body: repliedTo.body,
                          createdAt: repliedTo.createdAt.toISOString(),
                      },
        }
        const taken = await this.rooms.routeLine(line)
        const tagged = agentMentions.filter((agentId) => !taken.includes(agentId))
        if (tagged.length === 0) return
        await this.entityManager.transaction((tx) =>
            eachInOrder(tagged, async (agentId) => {
                await this.tags.handOff(tx, workspaceId, { userId, agentId, roomId: room.id, messageId: message.id, text: message.body })
            }),
        )
    }
}
