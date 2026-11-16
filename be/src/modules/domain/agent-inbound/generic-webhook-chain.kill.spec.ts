import { buildInboundRunner, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { webhookChain, WEBHOOK_DELIVERY } from "@tests/fixtures/builders/generic-webhook-chain.builder"

describe("generic webhook chain: the delivery job is run twice, the second run repeats no finished step", () => {
    it("a kill while the event is handed to the door: the transaction rolls back, the second run wakes the agent once, and a redelivery of the same receipt wakes nobody again", async () => {
        const h = await buildInboundRunner()
        const t = await webhookChain()
        h.claim(WEBHOOK_DELIVERY)
        t.door.accept.mockRejectedValueOnce(refused())

        await expect(h.run(t.processor, WEBHOOK_DELIVERY, 1)).rejects.toMatchObject({ params: { seconds: 60 } })

        expect(t.tx.rollbacks).toBe(1)
        expect(t.wakes.size).toBe(0)
        expect(h.claims.complete).not.toHaveBeenCalled()

        await h.run(t.processor, WEBHOOK_DELIVERY, 2)

        expect([...t.wakes]).toEqual(["conn-1:evt-1"])
        expect(h.claims.complete).toHaveBeenCalledTimes(1)

        // The same receipt is delivered again: the door keys the wake by the delivery id, so it wakes nobody a second time.
        await h.run(t.processor, WEBHOOK_DELIVERY, 1)

        expect([...t.wakes]).toEqual(["conn-1:evt-1"])
        expect(h.claims.park).not.toHaveBeenCalled()
    })
})
