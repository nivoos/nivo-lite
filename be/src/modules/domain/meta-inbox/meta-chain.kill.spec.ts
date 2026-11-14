import { buildInboundRunner, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { META_HANDOFF, META_RECEIPT, metaChain } from "@tests/fixtures/builders/meta-chain.builder"

describe("meta chain: each job is run twice, the second run repeats no finished step", () => {
    it("receipt job: a kill after the event was kept and before the receipt commits rolls back the handoff job with it; the second run writes the handoff once and completes once", async () => {
        const h = await buildInboundRunner()
        const t = await metaChain(h.claims)
        h.claim(META_RECEIPT)
        // The worker is gone while the receipt is completed: the person and the handoff job were written, nothing committed.
        t.intake.complete.mockRejectedValueOnce(refused())

        await expect(h.run(t.receiptProcessor, META_RECEIPT, 1)).rejects.toMatchObject({ params: { seconds: 60 } })

        expect(t.tx.rollbacks).toBe(1)
        expect(t.state.completed).toBe(false)
        expect(h.claims.complete).not.toHaveBeenCalled()

        await h.run(t.receiptProcessor, META_RECEIPT, 2)

        expect(t.tx.commits).toBe(1)
        expect(t.state.completed).toBe(true)
        // The handoff job exists exactly for the committed run, under its own once key.
        expect(t.tx.outcomes).toEqual(["rollback", "commit"])
        expect(t.write).toHaveBeenCalledWith(expect.anything(), "meta_inbound", expect.anything(), { job: "meta_inbound", dedupeKey: "meta_inbound:connection-1:dm:message-1" })

        // The broker delivers the same receipt again: it is completed, so no handoff is written and nothing is kept a second time.
        const writes = t.write.mock.calls.length
        await h.run(t.receiptProcessor, META_RECEIPT, 1)

        expect(t.write.mock.calls.length).toBe(writes)
        expect(t.intake.complete).toHaveBeenCalledTimes(2)
    })

    it("handoff job: a kill while the event is handed to the pipeline rolls back; the second run wakes the chatbot once", async () => {
        const h = await buildInboundRunner()
        const t = await metaChain(h.claims)
        h.claim(META_HANDOFF)
        t.triggers.deliver.mockRejectedValueOnce(refused())

        await expect(h.run(t.handoffProcessor, META_HANDOFF, 1)).rejects.toMatchObject({ params: { seconds: 60 } })

        expect(t.tx.rollbacks).toBe(1)
        expect(t.state.wakes).toBe(0)

        await h.run(t.handoffProcessor, META_HANDOFF, 2)

        expect(t.state.wakes).toBe(1)
        expect(t.tx.commits).toBe(1)
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
    })
})
