import { buildInboundRunner, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { sepayChain, SEPAY_DELIVERY } from "@tests/fixtures/builders/sepay-chain.builder"

describe("sepay chain: the delivery job is run twice, the second run repeats no finished step", () => {
    it("a kill while the order is settled: the transaction rolls back, the second run settles it once and completes the receipt once, and a redelivery does nothing", async () => {
        const h = await buildInboundRunner()
        const t = await sepayChain(h.claims)
        h.claim(SEPAY_DELIVERY)
        // The database goes away during the settlement: nothing of the first run is committed.
        t.tx.em.query.mockRejectedValueOnce(refused())

        await expect(h.run(t.processor, SEPAY_DELIVERY, 1)).rejects.toMatchObject({ params: { seconds: 60 } })

        expect(t.tx.rollbacks).toBe(1)
        expect(t.state.processed).toBe(false)
        expect(t.state.settles).toBe(0)
        expect(h.claims.complete).not.toHaveBeenCalled()

        await h.run(t.processor, SEPAY_DELIVERY, 2)

        expect(t.tx.commits).toBe(1)
        expect(t.state.processed).toBe(true)
        expect(t.state.settles).toBe(1)
        expect(h.claims.complete).toHaveBeenCalledTimes(1)

        // The broker delivers the same receipt again: it is processed, so the order is not settled a second time.
        await h.run(t.processor, SEPAY_DELIVERY, 1)

        expect(t.state.settles).toBe(1)
    })
})
