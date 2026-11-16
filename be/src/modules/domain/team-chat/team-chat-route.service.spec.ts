import { ANA, BOT, BOT_TWO, MSG, ROOM, ROUTE_PAYLOAD, WS, buildRouteChain } from "@tests/fixtures/builders/team-chat-route-chain.builder"

describe("TeamChatRouteService", () => {
    it("hands the router the stored message exactly as stored (room, words, the agents named, the line replied to) and nothing from memory", async () => {
        const t = await buildRouteChain()

        await t.service.routeJob(ROUTE_PAYLOAD)

        expect(t.rooms.routeLine).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: WS,
                userId: ANA,
                room: { id: ROOM, kind: "group", directKey: null },
                agentMentions: [BOT, BOT_TWO],
                repliedTo: null,
                message: expect.objectContaining({ id: MSG, body: "@a @b hello" }),
            }),
        )
    })

    it("ends doing nothing when the message is gone (a typed end, not a failure)", async () => {
        const t = await buildRouteChain()
        t.store.messagesByIds.mockResolvedValue([])

        await expect(t.service.routeJob(ROUTE_PAYLOAD)).resolves.toBeUndefined()

        expect(t.rooms.routeLine).not.toHaveBeenCalled()
        expect(t.tags.handOff).not.toHaveBeenCalled()
    })

    it("ends doing nothing for a payload that is no route (only the team chat writes the job)", async () => {
        const t = await buildRouteChain()

        await expect(t.service.routeJob({ other: true })).resolves.toBeUndefined()

        expect(t.store.messagesByIds).not.toHaveBeenCalled()
    })
})
