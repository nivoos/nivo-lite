import { ConnectionsErrorCode } from "@modules/domain/connections"
import { buildInboundRunner, pauseOf, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { webhookChain, WEBHOOK_DELIVERY } from "@tests/fixtures/builders/generic-webhook-chain.builder"

describe("generic webhook chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("a door that stays down is retried on the waited ladder (1, 2, 4, 8 min), then parks transient with ONE item; the resume wakes the agent", async () => {
        const h = await buildInboundRunner()
        const t = await webhookChain()
        h.claim(WEBHOOK_DELIVERY)
        t.door.accept.mockRejectedValue(refused())

        const pauses: Array<number | undefined> = []
        for (const attempt of [1, 2, 3, 4]) {
            const thrown = await h.run(t.processor, WEBHOOK_DELIVERY, attempt).catch((cause: unknown) => cause)
            pauses.push(pauseOf(thrown))
        }
        expect(pauses).toEqual([60, 120, 240, 480])
        expect(h.claims.park).not.toHaveBeenCalled()

        await h.run(t.processor, WEBHOOK_DELIVERY, 5)

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "generic_webhook" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.wakes.size).toBe(0)

        const resumed = await buildInboundRunner(1)
        resumed.claim(WEBHOOK_DELIVERY)
        const again = await webhookChain()
        await resumed.run(again.processor, WEBHOOK_DELIVERY, 1)

        expect([...again.wakes]).toEqual(["conn-1:evt-1"])
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("an endpoint that is gone is a typed end: the job finishes, nothing is woken, no dead letter", async () => {
        const h = await buildInboundRunner()
        const t = await webhookChain()
        h.claim(WEBHOOK_DELIVERY)
        t.connections.intakeOf.mockResolvedValue({ kind: "refused", code: ConnectionsErrorCode.NotFound })

        await h.run(t.processor, WEBHOOK_DELIVERY, 1)

        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(h.claims.park).not.toHaveBeenCalled()
        expect(t.wakes.size).toBe(0)
    })

    it("a receipt that is no delivery parks at once as an input failure with ONE item (no retry is spent)", async () => {
        const h = await buildInboundRunner()
        const t = await webhookChain()
        const broken = { nothing: true }
        h.claim(broken)

        await h.run(t.processor, broken, 1)

        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "payload refused: generic-webhook.deliver" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.door.accept).not.toHaveBeenCalled()
    })
})
