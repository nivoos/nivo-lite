import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { buildJobRunner, deliveryOf, refusedByNetwork } from "@tests/fixtures/builders/job-runner-harness.builder"
import { ProviderTriggersService } from "@modules/domain/provider-triggers"
import { DomainError } from "@modules/platform/errors"
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { QueueError, QueueErrorCode, type QueueDelivery } from "@modules/platform/queue"
import { DELIVER_TEAM_CHAT_TAG_JOB, TEAM_CHAT_TAG_QUEUE } from "@modules/queues/team-chat-tag"
import { TeamChatTagDeliveryService } from "./team-chat-tag-delivery.service"

const WS = "11111111-1111-4111-8111-111111111111"
const PAYLOAD = { workspaceId: WS, agentId: "agent-1", memberId: "seat-1", roomId: "room-1", messageId: "msg-1", text: "@bot quote" }
const delivery = (attempt: number): QueueDelivery => deliveryOf(TEAM_CHAT_TAG_QUEUE, DELIVER_TEAM_CHAT_TAG_JOB.name, PAYLOAD, attempt)

class TagRefused extends DomainError<"TEAM_CHAT_TAG_REFUSED"> {}

const build = async () => {
    const tx = fakeTransaction(mockEntityManager({}))
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockResolvedValue({ status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 })
    const moduleRef = await Test.createTestingModule({
        providers: [
            TeamChatTagDeliveryService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: ProviderTriggersService, useValue: triggers },
        ],
    }).compile()
    const service = moduleRef.get(TeamChatTagDeliveryService)
    const processor = new (class extends FencedProcessor {
        override readonly queue = TEAM_CHAT_TAG_QUEUE
        override readonly definition = DELIVER_TEAM_CHAT_TAG_JOB
        async process(job: ClaimedJob): Promise<void> {
            await service.deliverJob(job.payload)
        }
    })()
    return { triggers, processor }
}

describe("team chat tag chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes without repeating", () => {
    it("a delivery the pipeline refuses (input) parks at once with ONE item and no retry; after the cause is fixed the resume hands the tag over", async () => {
        const t = await build()
        const h = await buildJobRunner()
        h.claimed(PAYLOAD)
        t.triggers.deliver.mockRejectedValueOnce(new TagRefused({ code: "TEAM_CHAT_TAG_REFUSED" }))

        await h.runner.run(t.processor, delivery(1))

        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", queue: TEAM_CHAT_TAG_QUEUE }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", failureClass: "input", workspaceId: WS }))

        const resumed = await buildJobRunner(1)
        resumed.claimed(PAYLOAD)
        await resumed.runner.run(t.processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
        expect(t.triggers.deliver).toHaveBeenCalledTimes(2)
    })

    it("a database that is away retries on the waited ladder (60, 120, 240, 480 s), then parks with ONE item; the resume delivers once", async () => {
        const t = await build()
        const h = await buildJobRunner()
        h.claimed(PAYLOAD)
        t.triggers.deliver.mockRejectedValue(refusedByNetwork())

        const pauses: Array<number> = []
        for (const attempt of [1, 2, 3, 4]) {
            const thrown = await h.runner.run(t.processor, delivery(attempt)).catch((cause: unknown) => cause)
            expect(thrown).toBeInstanceOf(QueueError)
            expect(thrown).toMatchObject({ code: QueueErrorCode.RetryAfter })
            pauses.push((thrown as QueueError).params.seconds as number)
        }
        expect(pauses).toEqual([60, 120, 240, 480])

        await h.runner.run(t.processor, delivery(5))

        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)

        t.triggers.deliver.mockResolvedValue({ status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 })
        const resumed = await buildJobRunner(1)
        resumed.claimed(PAYLOAD)
        await resumed.runner.run(t.processor, delivery(1))

        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
    })
})
