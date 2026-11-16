import { buildInboundRunner, pauseOf, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { sepayChain, SEPAY_DELIVERY } from "@tests/fixtures/builders/sepay-chain.builder"

describe("sepay chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("a database that stays down is retried on the waited ladder (1, 2, 4, 8 min), then parks transient with ONE item and the order unpaid; the resume settles it", async () => {
        const h = await buildInboundRunner()
        const t = await sepayChain(h.claims)
        h.claim(SEPAY_DELIVERY)
        const settle = t.tx.em.query.getMockImplementation()
        t.tx.em.query.mockRejectedValue(refused())

        const pauses: Array<number | undefined> = []
        for (const attempt of [1, 2, 3, 4]) {
            const thrown = await h.run(t.processor, SEPAY_DELIVERY, attempt).catch((cause: unknown) => cause)
            pauses.push(pauseOf(thrown))
        }
        expect(pauses).toEqual([60, 120, 240, 480])
        expect(h.claims.park).not.toHaveBeenCalled()
        expect(h.deadLetters.raise).not.toHaveBeenCalled()

        await h.run(t.processor, SEPAY_DELIVERY, 5)

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "sepay-delivery" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.state.processed).toBe(false)
        expect(t.state.settles).toBe(0)

        // The database is back; a person resumes the job.
        if (settle !== undefined) t.tx.em.query.mockImplementation(settle)
        const resumed = await buildInboundRunner(1)
        resumed.claim(SEPAY_DELIVERY)
        await resumed.run(t.processorWith(resumed.claims), SEPAY_DELIVERY, 1)

        expect(t.state.processed).toBe(true)
        expect(t.state.settles).toBe(1)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })
})
