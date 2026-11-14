import { buildPublicApiChain, OWED_REPLY, API_WS } from "@tests/fixtures/builders/public-api-chain.builder"
import { buildJobRunner, deliveryOf } from "@tests/fixtures/builders/job-runner-harness.builder"
import { ChannelsError, ChannelsErrorCode } from "@modules/domain/channels"
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import { QueueError, QueueErrorCode, type QueueDelivery } from "@modules/platform/queue"
import { PUBLIC_API_QUEUE, SEND_PUBLIC_MESSAGE_JOB } from "@modules/queues/public-api"
import { PublicApiErrorCode } from "./errors/public-api.error"
import type { PublicMessageDeliveryService } from "./public-message-delivery.service"

const delivery = (attempt: number): QueueDelivery => deliveryOf(PUBLIC_API_QUEUE, SEND_PUBLIC_MESSAGE_JOB.name, OWED_REPLY, attempt)

/** The processor of the send job as the feature composes it: one domain call; the dead letter writes the evidence line. */
const processorOf = (service: PublicMessageDeliveryService): FencedProcessor =>
    new (class extends FencedProcessor {
        override readonly queue = PUBLIC_API_QUEUE
        override readonly definition = SEND_PUBLIC_MESSAGE_JOB
        async process(job: ClaimedJob): Promise<void> {
            await service.sendJob(job)
        }
        override async onFailed(queued: QueueDelivery, cause: unknown): Promise<void> {
            await service.sendStopped(queued.payload, cause)
        }
    })()

describe("public API chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes without repeating", () => {
    it("a provider that stays busy (the send is unavailable for now) retries on the background ladder (5, 10, 20 s), then parks with ONE item; the resume sends the message once", async () => {
        const t = await buildPublicApiChain()
        const processor = processorOf(t.service)
        const h = await buildJobRunner()
        h.claimed(OWED_REPLY)
        t.channels.deliverToPerson.mockRejectedValue(new ChannelsError({ code: ChannelsErrorCode.SendUnavailable }))

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
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: PUBLIC_API_QUEUE }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", failureClass: "transient", workspaceId: API_WS }))
        expect(t.events.record).toHaveBeenCalledTimes(1)
        // Every busy answer released the claim (a refused row): each start could send, none did.
        expect(await t.ledger.byKey(API_WS, OWED_REPLY.sendKey)).toMatchObject({ state: "refused", reason: "channel_busy" })

        t.channels.deliverToPerson.mockResolvedValue({ delivered: true, failure: null, outcome: "acknowledged" })
        const resumed = await buildJobRunner(1)
        resumed.claimed(OWED_REPLY)
        await resumed.runner.run(processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
        expect(await t.ledger.byKey(API_WS, OWED_REPLY.sendKey)).toMatchObject({ state: "delivered" })
        expect(t.channels.deliverToPerson).toHaveBeenCalledTimes(5)
    })

    it("an uncertain earlier send is a dead letter at once (class input) with ONE item; the person's resume is the decision to send it again", async () => {
        const t = await buildPublicApiChain()
        const processor = processorOf(t.service)
        const h = await buildJobRunner()
        h.claimed(OWED_REPLY)
        t.channels.deliverToPerson.mockResolvedValue({ delivered: false, failure: null, outcome: "ambiguous" })
        await h.runner.run(processor, delivery(1))
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(await t.ledger.byKey(API_WS, OWED_REPLY.sendKey)).toMatchObject({ state: "unknown" })

        // The broker delivers the job again (the first start's answer was lost): the claim is uncertain, nothing is sent.
        const again = await buildJobRunner()
        again.claimed(OWED_REPLY)
        await again.runner.run(processor, delivery(1))

        expect(again.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: PublicApiErrorCode.SendOutcomeUnknown }))
        expect(again.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.channels.deliverToPerson).toHaveBeenCalledTimes(1)

        t.channels.deliverToPerson.mockResolvedValue({ delivered: true, failure: null, outcome: "acknowledged" })
        const resumed = await buildJobRunner(1)
        resumed.claimed(OWED_REPLY)
        await resumed.runner.run(processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.channels.deliverToPerson).toHaveBeenCalledTimes(2)
        expect(await t.ledger.byKey(API_WS, OWED_REPLY.sendKey)).toMatchObject({ state: "delivered" })
    })
})
