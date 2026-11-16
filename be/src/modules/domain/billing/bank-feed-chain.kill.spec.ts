import { buildInboundRunner, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { bankFeedChain, FEED_DELIVERY } from "@tests/fixtures/builders/bank-feed-chain.builder"

describe("bank-feed chain: the delivery job is run twice, the second run repeats no finished step", () => {
    it("a kill while the wake is written: the transaction rolls back, the second run keeps the movement and writes its wake once, and a redelivery after it does nothing", async () => {
        const h = await buildInboundRunner()
        const t = await bankFeedChain(h.claims)
        h.claim(FEED_DELIVERY)
        // The worker is gone while the wake is being written: nothing of the first run was committed.
        t.triggers.deliver.mockRejectedValueOnce(refused())

        await expect(h.run(t.processor, FEED_DELIVERY, 1)).rejects.toMatchObject({ params: { seconds: 60 } })

        expect(t.tx.rollbacks).toBe(1)
        expect(t.tx.commits).toBe(0)
        expect(t.state.completed).toBe(false)
        expect(t.state.wakes).toBe(0)
        expect(h.claims.complete).not.toHaveBeenCalled()

        await h.run(t.processor, FEED_DELIVERY, 2)

        expect(t.tx.commits).toBe(1)
        expect(t.feedInbox.complete).toHaveBeenCalledTimes(1)
        expect(t.state.wakes).toBe(1)
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(h.claims.park).not.toHaveBeenCalled()

        // The broker delivers the same receipt again: it is completed, so nothing is kept, woken or completed a second time.
        await h.run(t.processor, FEED_DELIVERY, 1)

        expect(t.state.wakes).toBe(1)
        expect(t.feedInbox.complete).toHaveBeenCalledTimes(1)
    })
})
