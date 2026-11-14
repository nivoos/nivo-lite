import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import type { EntityManager } from "typeorm"
import { messageOf, roomOf } from "@tests/fixtures/builders/team-chat.builder"
import { TEAM_CHAT_TAGS } from "@modules/domain/team-chat/team-chat.decorators"
import type { TeamChatTags } from "@modules/domain/team-chat/team-chat.port"
import { TeamChatRouteService } from "@modules/domain/team-chat/team-chat-route.service"
import { TeamChatStoreService } from "@modules/domain/team-chat/team-chat-store.service"
import { TeamChatRoomsService } from "@modules/domain/team-chat/team-chat.service"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"

export const WS = "11111111-1111-4111-8111-111111111111"
export const ANA = "22222222-1111-4111-8111-111111111111"
export const BOT = "31111111-1111-4111-8111-111111111111"
export const BOT_TWO = "32222222-1111-4111-8111-111111111111"
export const ROOM = "41111111-1111-4111-8111-111111111111"
export const MSG = "51111111-1111-4111-8111-111111111111"

/** The payload of the route job of the stored message `MSG`. */
export const ROUTE_PAYLOAD = { workspaceId: WS, userId: ANA, roomId: ROOM, messageId: MSG }

/** The real route service over doubles: the stored message names two agents, the router answers the agents whose turn it took. */
export const buildRouteChain = async () => {
    const tx = fakeTransaction(mockEntityManager({}))
    const store = mock<TeamChatStoreService>()
    store.messagesByIds.mockResolvedValue([
        messageOf({
            id: MSG,
            body: "@a @b hello",
            mentions: [
                { kind: "agent", id: BOT },
                { kind: "agent", id: BOT_TWO },
                { kind: "user", id: "23333333-1111-4111-8111-111111111111" },
            ],
        }),
    ])
    store.roomById.mockResolvedValue(roomOf())
    const rooms = mock<TeamChatRoomsService>()
    rooms.routeLine.mockResolvedValue([])
    const tags = mock<TeamChatTags>()
    tags.handOff.mockResolvedValue(true)
    const moduleRef = await Test.createTestingModule({
        providers: [
            TeamChatRouteService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: TeamChatStoreService, useValue: store },
            { provide: TeamChatRoomsService, useValue: rooms },
            { provide: TEAM_CHAT_TAGS, useValue: tags },
        ],
    }).compile()
    return { service: moduleRef.get(TeamChatRouteService), store, rooms, tags, tx: tx.em as EntityManager }
}
