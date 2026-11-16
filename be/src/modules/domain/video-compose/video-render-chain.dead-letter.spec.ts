import { buildInboundRunner, pauseOf, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { renderChain, RENDER_DELIVERY } from "@tests/fixtures/builders/video-render-chain.builder"
import { QueueError, QueueErrorCode } from "@modules/platform/queue"

describe("video render chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("a delivery refused for good parks at once with ONE item and the row pending; after the cause is fixed the resume wakes the run", async () => {
        const h = await buildInboundRunner()
        const t = await renderChain()
        h.claim(RENDER_DELIVERY)
        t.triggers.deliver.mockRejectedValueOnce(new QueueError({ code: QueueErrorCode.FlowFailure, params: { failureClass: "input", reason: "the row is refused" } }))

        await h.run(t.processor, RENDER_DELIVERY, 1)

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", queue: "video-render-delivery" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.state.completed).toBe(false)
        expect(t.state.wakes).toBe(0)

        const resumed = await buildInboundRunner(1)
        resumed.claim(RENDER_DELIVERY)
        const again = await renderChain()
        await resumed.run(again.processor, RENDER_DELIVERY, 1)

        expect(again.state.wakes).toBe(1)
        expect(again.state.completed).toBe(true)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("a pipeline that stays down is retried on the waited ladder, then parks transient with ONE item; the resume finishes", async () => {
        const h = await buildInboundRunner()
        const t = await renderChain()
        h.claim(RENDER_DELIVERY)
        t.triggers.deliver.mockRejectedValue(refused())

        const pauses: Array<number | undefined> = []
        for (const attempt of [1, 2, 3, 4]) {
            const thrown = await h.run(t.processor, RENDER_DELIVERY, attempt).catch((cause: unknown) => cause)
            pauses.push(pauseOf(thrown))
        }
        expect(pauses).toEqual([60, 120, 240, 480])
        expect(h.deadLetters.raise).not.toHaveBeenCalled()

        await h.run(t.processor, RENDER_DELIVERY, 5)

        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)

        const resumed = await buildInboundRunner(1)
        resumed.claim(RENDER_DELIVERY)
        const again = await renderChain()
        await resumed.run(again.processor, RENDER_DELIVERY, 1)

        expect(again.state.completed).toBe(true)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
    })
})
