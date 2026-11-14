import { buildInboundRunner, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { renderChain, RENDER_DELIVERY } from "@tests/fixtures/builders/video-render-chain.builder"

describe("video render chain: the delivery job is run twice, the second run repeats no finished step", () => {
    it("a kill while the wake is written: the transaction rolls back, the second run wakes the waiting run once and completes the row, and a redelivery does nothing", async () => {
        const h = await buildInboundRunner()
        const t = await renderChain()
        h.claim(RENDER_DELIVERY)
        t.triggers.deliver.mockRejectedValueOnce(refused())

        await expect(h.run(t.processor, RENDER_DELIVERY, 1)).rejects.toMatchObject({ params: { seconds: 60 } })

        expect(t.tx.rollbacks).toBe(1)
        expect(t.state.completed).toBe(false)
        expect(h.claims.complete).not.toHaveBeenCalled()

        await h.run(t.processor, RENDER_DELIVERY, 2)

        expect(t.state.wakes).toBe(1)
        expect(t.intake.complete).toHaveBeenCalledTimes(1)
        expect(h.claims.complete).toHaveBeenCalledTimes(1)

        await h.run(t.processor, RENDER_DELIVERY, 1)

        expect(t.state.wakes).toBe(1)
        expect(t.intake.complete).toHaveBeenCalledTimes(1)
    })
})
