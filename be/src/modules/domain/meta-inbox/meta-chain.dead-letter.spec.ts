import { buildInboundRunner, pauseOf, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { META_HANDOFF, META_RECEIPT, metaChain } from "@tests/fixtures/builders/meta-chain.builder"

describe("meta chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("receipt job: a database that stays down is retried on the waited ladder, then parks transient with ONE item and the receipt pending; the resume finishes it", async () => {
        const h = await buildInboundRunner()
        const t = await metaChain(h.claims)
        h.claim(META_RECEIPT)
        t.connections.recordEvent.mockRejectedValue(refused())

        const pauses: Array<number | undefined> = []
        for (const attempt of [1, 2, 3, 4]) {
            const thrown = await h.run(t.receiptProcessor, META_RECEIPT, attempt).catch((cause: unknown) => cause)
            pauses.push(pauseOf(thrown))
        }
        expect(pauses).toEqual([60, 120, 240, 480])
        expect(h.claims.park).not.toHaveBeenCalled()

        await h.run(t.receiptProcessor, META_RECEIPT, 5)

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "meta-delivery" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.state.completed).toBe(false)

        t.connections.recordEvent.mockResolvedValue(null)
        const resumed = await buildInboundRunner(1)
        resumed.claim(META_RECEIPT)
        const again = await metaChain(resumed.claims)
        await resumed.run(again.receiptProcessor, META_RECEIPT, 1)

        expect(again.state.completed).toBe(true)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("handoff job: a switched-off account and a removed account are TYPED ENDS that finish the job (logged), never a failure", async () => {
        const h = await buildInboundRunner()
        const t = await metaChain(h.claims)
        h.claim(META_HANDOFF)
        t.triggers.deliver.mockResolvedValueOnce({ status: "off" })

        await h.run(t.handoffProcessor, META_HANDOFF, 1)

        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(h.claims.park).not.toHaveBeenCalled()
        expect(t.state.wakes).toBe(0)
    })

    it("handoff job: a payload that is no queued Meta event parks at once as an input failure with ONE item", async () => {
        const h = await buildInboundRunner()
        const t = await metaChain(h.claims)
        const broken = { connectionId: "connection-1" }
        h.claim(broken)

        await h.run(t.handoffProcessor, broken, 1)

        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "payload refused: meta_inbound" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.triggers.deliver).not.toHaveBeenCalled()
    })

    it("handoff job: a pipeline that stays down parks transient; the resume delivers the event once", async () => {
        const h = await buildInboundRunner()
        const t = await metaChain(h.claims)
        h.claim(META_HANDOFF)
        t.triggers.deliver.mockRejectedValue(refused())
        for (const attempt of [1, 2, 3, 4]) await h.run(t.handoffProcessor, META_HANDOFF, attempt).catch((cause: unknown) => cause)

        await h.run(t.handoffProcessor, META_HANDOFF, 5)

        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "meta_inbound" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)

        const resumed = await buildInboundRunner(1)
        resumed.claim(META_HANDOFF)
        const again = await metaChain(resumed.claims)
        await resumed.run(again.handoffProcessor, META_HANDOFF, 1)

        expect(again.state.wakes).toBe(1)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
    })
})
