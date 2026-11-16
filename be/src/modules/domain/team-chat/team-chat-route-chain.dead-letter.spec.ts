import { buildJobRunner, deliveryOf, refusedByNetwork } from "@tests/fixtures/builders/job-runner-harness.builder"
import { BOT_TWO, ROUTE_PAYLOAD, WS, buildRouteChain } from "@tests/fixtures/builders/team-chat-route-chain.builder"
import { DomainError } from "@modules/platform/errors"
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import { QueueError, QueueErrorCode, type QueueDelivery } from "@modules/platform/queue"
import { ROUTE_TEAM_CHAT_MESSAGE_JOB, TEAM_CHAT_TAG_QUEUE } from "@modules/queues/team-chat-tag"

const delivery = (attempt: number): QueueDelivery =>
    deliveryOf(TEAM_CHAT_TAG_QUEUE, ROUTE_TEAM_CHAT_MESSAGE_JOB.name, ROUTE_PAYLOAD, attempt)

class RouteRefused extends DomainError<"TEAM_CHAT_ROUTE_REFUSED"> {}

const build = async () => {
    const t = await buildRouteChain()
    const processor = new (class extends FencedProcessor {
        override readonly queue = TEAM_CHAT_TAG_QUEUE
        override readonly definition = ROUTE_TEAM_CHAT_MESSAGE_JOB
        async process(job: ClaimedJob): Promise<void> {
            await t.service.routeJob(job.payload)
        }
    })()
    return { ...t, processor }
}

describe("team chat route chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes without repeating", () => {
    it("a tag the work core refuses (input) parks at once with ONE item and no retry; after the cause is fixed the resume writes the tag", async () => {
        const t = await build()
        const h = await buildJobRunner()
        h.claimed(ROUTE_PAYLOAD)
        t.tags.handOff.mockRejectedValueOnce(new RouteRefused({ code: "TEAM_CHAT_ROUTE_REFUSED" }))

        await h.runner.run(t.processor, delivery(1))

        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", queue: TEAM_CHAT_TAG_QUEUE }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "flow-parked", failureClass: "input", workspaceId: WS }),
        )

        const resumed = await buildJobRunner(1)
        resumed.claimed(ROUTE_PAYLOAD)
        await resumed.runner.run(t.processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
        expect(t.tags.handOff).toHaveBeenLastCalledWith(expect.anything(), WS, expect.objectContaining({ agentId: BOT_TWO }))
    })

    it("a router or database that is away retries on the waited ladder (60, 120, 240, 480 s), then parks with ONE item; the resume routes once", async () => {
        const t = await build()
        const h = await buildJobRunner()
        h.claimed(ROUTE_PAYLOAD)
        t.rooms.routeLine.mockRejectedValue(refusedByNetwork())

        const pauses: Array<number> = []
        for (const attempt of [1, 2, 3, 4]) {
            const thrown = await h.runner.run(t.processor, delivery(attempt)).catch((cause: unknown) => cause)
            expect(thrown).toBeInstanceOf(QueueError)
            expect(thrown).toMatchObject({ code: QueueErrorCode.RetryAfter })
            pauses.push((thrown as QueueError).params.seconds as number)
        }
        expect(pauses).toEqual([60, 120, 240, 480])

        await h.runner.run(t.processor, delivery(5))

        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)

        t.rooms.routeLine.mockResolvedValue([])
        const resumed = await buildJobRunner(1)
        resumed.claimed(ROUTE_PAYLOAD)
        await resumed.runner.run(t.processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.tags.handOff).toHaveBeenCalledTimes(2)
    })
})
