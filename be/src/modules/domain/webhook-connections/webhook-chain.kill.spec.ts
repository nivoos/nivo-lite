import { buildWebhookChain, deliveryJob } from "@tests/fixtures/builders/webhook-chain.builder"

/** The process "dies" here: the error a call throws when its worker is gone before the call's outcome is known. */
const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

describe("webhook chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("a kill after the POST reached the receiver and before the effect settled: the second run posts the same delivery again (the receiver dedupes on x-nivo-delivery); a third run posts nothing", async () => {
        const t = await buildWebhookChain()
        t.ledger.loseNext("job-1:webhook.post", killed())

        await expect(t.service.deliver(deliveryJob())).rejects.toMatchObject({ code: "ECONNRESET" })
        expect(t.posts).toHaveLength(1)

        await t.service.deliver(deliveryJob())

        // The lost outcome of a repeatable effect is acted again under the same key and the same delivery id.
        expect(t.posts).toHaveLength(2)
        expect(t.posts[1]?.["x-nivo-delivery"]).toBe(t.posts[0]?.["x-nivo-delivery"])
        expect(t.posts[1]?.["x-nivo-timestamp"]).toBe(t.posts[0]?.["x-nivo-timestamp"])
        expect(t.ledger.rows.get("job-1:webhook.post")?.kept).toBe(200)

        // The effect is settled: the job run again (a redelivery of the broker) posts nothing.
        await t.service.deliver(deliveryJob())

        expect(t.posts).toHaveLength(2)
    })

    it("a kill before the POST: the second run posts it once", async () => {
        const t = await buildWebhookChain()
        t.ledger.failNext("job-1:webhook.post", killed())

        await expect(t.service.deliver(deliveryJob())).rejects.toMatchObject({ code: "ECONNRESET" })
        expect(t.posts).toHaveLength(0)

        await t.service.deliver(deliveryJob())

        expect(t.posts).toHaveLength(1)
        expect(t.ledger.rows.get("job-1:webhook.post")?.acts).toBe(1)
    })

    it("clears the failure a dead letter showed on the connection once the delivery is accepted, and not before", async () => {
        const t = await buildWebhookChain()
        t.record.current = { ...t.record.current, lastError: "WEBHOOK_CONNECTIONS_RECEIVER_REFUSED" }
        t.ledger.failNext("job-1:webhook.post", killed())

        await expect(t.service.deliver(deliveryJob())).rejects.toMatchObject({ code: "ECONNRESET" })
        expect(t.record.current.lastError).toBe("WEBHOOK_CONNECTIONS_RECEIVER_REFUSED")

        await t.service.deliver(deliveryJob())

        expect(t.record.current.lastError).toBeNull()
    })
})
