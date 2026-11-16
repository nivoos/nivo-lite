import { buildInboundRunner, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { telegramChain, TELEGRAM_DELIVERY } from "@tests/fixtures/builders/telegram-chain.builder"

describe("telegram chain: the delivery job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill after the photo was kept and before the wake commits: the second run keeps the same entry WITHOUT reading the channel again, wakes once and completes once", async () => {
        const h = await buildInboundRunner()
        const t = await telegramChain(h.claims)
        h.claim(TELEGRAM_DELIVERY)
        // The worker is gone while the wake is being written: the photo's effect had settled, the transaction had not committed.
        t.triggers.deliver.mockRejectedValueOnce(refused())

        await expect(h.run(t.processor, TELEGRAM_DELIVERY, 1)).rejects.toMatchObject({ params: { seconds: 60 } })

        expect(t.remote.read).toHaveBeenCalledTimes(1)
        expect(t.ledger.rows.get("job-1:file:0")).toMatchObject({ acts: 1, settled: true })
        expect(t.tx.rollbacks).toBe(1)
        expect(t.state.completed).toBe(false)

        await h.run(t.processor, TELEGRAM_DELIVERY, 2)

        expect(t.remote.read).toHaveBeenCalledTimes(1)
        expect(t.assets.upload).toHaveBeenCalledTimes(1)
        expect(t.state.wakes).toBe(1)
        expect(t.intake.complete).toHaveBeenCalledTimes(1)
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.triggers.deliver.mock.calls[1]?.[0].events[0]?.files).toHaveLength(1)

        await h.run(t.processor, TELEGRAM_DELIVERY, 1)

        expect(t.remote.read).toHaveBeenCalledTimes(1)
        expect(t.state.wakes).toBe(1)
        expect(t.intake.complete).toHaveBeenCalledTimes(1)
    })
})
