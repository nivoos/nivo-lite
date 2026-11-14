import { buildInboundRunner, pauseOf, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { bankFeedChain, FEED_DELIVERY } from "@tests/fixtures/builders/bank-feed-chain.builder"
import { BillingError, BillingErrorCode } from "./errors/billing.error"

const woke = { status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 } as const

describe("bank-feed chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("a wake that cannot be written for good (refused input) parks at once with ONE item and the receipt pending; after the cause is fixed the resume finishes it", async () => {
        const h = await buildInboundRunner()
        const t = await bankFeedChain(h.claims)
        h.claim(FEED_DELIVERY)
        t.triggers.deliver.mockRejectedValueOnce(new BillingError({ code: BillingErrorCode.WebhookInvalid }))

        await h.run(t.processor, FEED_DELIVERY, 1)

        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", queue: "bank-feed-delivery" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", failureClass: "input", jobId: "job-1" }))
        // The movement is NOT kept without its wake: the receipt is still pending and nothing was committed.
        expect(t.state.completed).toBe(false)
        expect(t.tx.commits).toBe(0)
        expect(h.claims.complete).not.toHaveBeenCalled()

        // The cause is fixed; a person resumes the job (the same receipt, the next episode).
        const resumed = await buildInboundRunner(1)
        const again = await bankFeedChain(resumed.claims)
        resumed.claim(FEED_DELIVERY)
        await resumed.run(again.processor, FEED_DELIVERY, 1)

        expect(again.state.wakes).toBe(1)
        expect(again.feedInbox.complete).toHaveBeenCalledTimes(1)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("a store that stays down is retried on the waited ladder (1, 2, 4, 8 min), then parks transient with ONE item; the resume completes the receipt", async () => {
        const h = await buildInboundRunner()
        const t = await bankFeedChain(h.claims)
        h.claim(FEED_DELIVERY)
        t.triggers.deliver.mockRejectedValue(refused())

        const pauses: Array<number | undefined> = []
        for (const attempt of [1, 2, 3, 4]) {
            const thrown = await h.run(t.processor, FEED_DELIVERY, attempt).catch((cause: unknown) => cause)
            pauses.push(pauseOf(thrown))
        }
        expect(pauses).toEqual([60, 120, 240, 480])
        expect(h.claims.park).not.toHaveBeenCalled()
        expect(h.deadLetters.raise).not.toHaveBeenCalled()

        await h.run(t.processor, FEED_DELIVERY, 5)

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.state.completed).toBe(false)

        // The store is back; a person resumes the job.
        t.triggers.deliver.mockReset()
        t.triggers.deliver.mockImplementation(() => {
            t.state.wakes += 1
            return Promise.resolve(woke)
        })
        const resumed = await buildInboundRunner(1)
        resumed.claim(FEED_DELIVERY)
        const again = await bankFeedChain(resumed.claims)
        await resumed.run(again.processor, FEED_DELIVERY, 1)

        expect(again.state.wakes).toBe(1)
        expect(again.state.completed).toBe(true)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
    })
})
