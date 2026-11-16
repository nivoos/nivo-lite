import { ANA, BOT, BOT_TWO, MSG, ROOM, ROUTE_PAYLOAD, WS, buildRouteChain } from "@tests/fixtures/builders/team-chat-route-chain.builder"

/** The process "dies" here: the error a call throws when its worker is gone before the call's outcome is known. */
const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

describe("team chat route chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill in the transaction that finishes the job writes no tag; the second run asks the router again and writes ONE tag job per agent the router did not take", async () => {
        const t = await buildRouteChain()
        t.rooms.routeLine.mockResolvedValue([BOT])
        t.tags.handOff.mockRejectedValueOnce(killed())

        await expect(t.service.routeJob(ROUTE_PAYLOAD)).rejects.toMatchObject({ code: "ECONNRESET" })

        await t.service.routeJob(ROUTE_PAYLOAD)

        // The router took BOT (its own turn, started once: it answers taken again on the re-run); only BOT_TWO goes to the tag path.
        expect(t.tags.handOff).toHaveBeenCalledTimes(2)
        expect(t.tags.handOff).toHaveBeenLastCalledWith(expect.anything(), WS, {
            userId: ANA,
            agentId: BOT_TWO,
            roomId: ROOM,
            messageId: MSG,
            text: "@a @b hello",
        })
        expect(t.tags.handOff).not.toHaveBeenCalledWith(expect.anything(), WS, expect.objectContaining({ agentId: BOT }))
    })

    it("a message the router took for every agent it names writes no tag at all, and a run again writes none", async () => {
        const t = await buildRouteChain()
        t.rooms.routeLine.mockResolvedValue([BOT, BOT_TWO])

        await t.service.routeJob(ROUTE_PAYLOAD)
        await t.service.routeJob(ROUTE_PAYLOAD)

        expect(t.tags.handOff).not.toHaveBeenCalled()
    })
})
