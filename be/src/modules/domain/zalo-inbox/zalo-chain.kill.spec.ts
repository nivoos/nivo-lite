import { buildInboundRunner, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { zaloChain, ZALO_DELIVERY } from "@tests/fixtures/builders/zalo-chain.builder"

describe("zalo chain: the delivery job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill after the picture was kept and before the wake commits: the second run keeps the same entry WITHOUT reading the channel again, wakes once and completes once", async () => {
        const h = await buildInboundRunner()
        const t = await zaloChain(h.claims)
        h.claim(ZALO_DELIVERY)
        // The worker is gone while the wake is being written: the picture's effect had settled, the transaction had not committed.
        t.triggers.deliver.mockRejectedValueOnce(refused())

        await expect(h.run(t.processor, ZALO_DELIVERY, 1)).rejects.toMatchObject({ params: { seconds: 60 } })

        expect(t.remote.read).toHaveBeenCalledTimes(1)
        expect(t.ledger.rows.get("job-1:file:0")).toMatchObject({ acts: 1, settled: true })
        expect(t.tx.rollbacks).toBe(1)
        expect(t.state.completed).toBe(false)
        expect(h.claims.complete).not.toHaveBeenCalled()

        await h.run(t.processor, ZALO_DELIVERY, 2)

        // The channel was read ONCE in all: the second run took the kept entry from the ledger (its address may have expired).
        expect(t.remote.read).toHaveBeenCalledTimes(1)
        expect(t.assets.upload).toHaveBeenCalledTimes(1)
        expect(t.ledger.rows.get("job-1:file:0")?.acts).toBe(1)
        expect(t.state.wakes).toBe(1)
        expect(t.intake.complete).toHaveBeenCalledTimes(1)
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.triggers.deliver.mock.calls[1]?.[0].events[0]?.files).toHaveLength(1)

        // The broker delivers the same receipt again: the event is completed, so nothing is read, woken or completed a second time.
        await h.run(t.processor, ZALO_DELIVERY, 1)

        expect(t.remote.read).toHaveBeenCalledTimes(1)
        expect(t.state.wakes).toBe(1)
        expect(t.intake.complete).toHaveBeenCalledTimes(1)
    })
})
