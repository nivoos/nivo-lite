import { buildJobRunner, deliveryOf } from "@tests/fixtures/builders/job-runner-harness.builder"
import { buildWebhookChain, DELIVERY } from "@tests/fixtures/builders/webhook-chain.builder"
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import { QueueError, QueueErrorCode, type QueueDelivery } from "@modules/platform/queue"
import { EMIT_WEBHOOK_JOB, N8N_QUEUE } from "@modules/queues/n8n"
import { WebhookConnectionsError, WebhookConnectionsErrorCode } from "./errors/webhook-connections.error"
import type { WebhookEventsService } from "./webhook-events.service"

const delivery = (attempt: number): QueueDelivery => deliveryOf(N8N_QUEUE, EMIT_WEBHOOK_JOB.name, DELIVERY, attempt)

/** The processor of the webhook job as the feature composes it: one domain method; the dead letter shows the reason on the connection. */
const processorOf = (service: WebhookEventsService): FencedProcessor =>
    new (class extends FencedProcessor {
        override readonly queue = N8N_QUEUE
        override readonly definition = EMIT_WEBHOOK_JOB
        async process(job: ClaimedJob): Promise<void> {
            await service.deliver(job)
        }
        override async onFailed(queued: QueueDelivery, cause: unknown): Promise<void> {
            await service.deliveryFailed(queued.payload, cause)
        }
    })()

describe("webhook chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes without repeating", () => {
    it("a receiver that refuses the delivery (4xx) parks at once with ONE item, the connection shows why, and after the receiver is fixed the resume posts once and clears it", async () => {
        const t = await buildWebhookChain()
        const processor = processorOf(t.service)
        const h = await buildJobRunner()
        h.claimed(DELIVERY)
        t.answers({ status: 410, failure: null, durationMs: 3 })

        await h.runner.run(processor, delivery(1))

        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "WEBHOOK_CONNECTIONS_RECEIVER_REFUSED", queue: N8N_QUEUE }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", failureClass: "input", workspaceId: DELIVERY.workspaceId, jobId: "job-1" }))
        expect(t.record.current.lastError).toBe("WEBHOOK_CONNECTIONS_RECEIVER_REFUSED")
        expect(t.posts).toHaveLength(1)

        // The receiver is fixed; a person resumes the job: it posts the same delivery once and clears the failure.
        t.answers({ status: 200, failure: null, durationMs: 3 })
        const resumed = await buildJobRunner(1)
        resumed.claimed(DELIVERY)
        await resumed.runner.run(processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.claims.park).not.toHaveBeenCalled()
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
        expect(t.posts).toHaveLength(2)
        expect(t.posts[1]?.["x-nivo-delivery"]).toBe(t.posts[0]?.["x-nivo-delivery"])
        expect(t.record.current.lastError).toBeNull()
    })

    it("a receiver that is down (503) retries on the background ladder (5, 10, 20 s), then parks with ONE item; the resume posts it once the receiver is back", async () => {
        const t = await buildWebhookChain()
        const processor = processorOf(t.service)
        const h = await buildJobRunner()
        h.claimed(DELIVERY)
        t.answers({ status: 503, failure: null, durationMs: 3 })

        const pauses: Array<number> = []
        for (const attempt of [1, 2, 3]) {
            const thrown = await h.runner.run(processor, delivery(attempt)).catch((cause: unknown) => cause)
            expect(thrown).toBeInstanceOf(QueueError)
            expect(thrown).toMatchObject({ code: QueueErrorCode.RetryAfter })
            pauses.push((thrown as QueueError).params.seconds as number)
        }
        expect(pauses).toEqual([5, 10, 20])
        expect(h.claims.park).not.toHaveBeenCalled()

        await h.runner.run(processor, delivery(4))

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.record.current.lastError).toBe("WEBHOOK_CONNECTIONS_RECEIVER_UNAVAILABLE")
        // Each start released its intent (a 503 settles nothing), so each posted again under the same key.
        expect(t.posts).toHaveLength(4)

        t.answers({ status: 204, failure: null, durationMs: 3 })
        const resumed = await buildJobRunner(1)
        resumed.claimed(DELIVERY)
        await resumed.runner.run(processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.posts).toHaveLength(5)
        expect(t.record.current.lastError).toBeNull()
        expect(t.ledger.rows.get("job-1:webhook.post")?.kept).toBe(204)
    })

    it("a connection with no address is a dead letter (class input), not a dropped delivery: ONE item", async () => {
        const t = await buildWebhookChain()
        const h = await buildJobRunner()
        h.claimed(DELIVERY)
        t.answers(new WebhookConnectionsError({ code: WebhookConnectionsErrorCode.NoUrl }))

        await h.runner.run(processorOf(t.service), delivery(1))

        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "WEBHOOK_CONNECTIONS_NO_URL" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.record.current.lastError).toBe("WEBHOOK_CONNECTIONS_NO_URL")
    })
})
