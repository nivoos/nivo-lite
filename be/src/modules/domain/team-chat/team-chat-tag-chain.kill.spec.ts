import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { AgentOwnershipService } from "@modules/domain/agents"
import { ProviderTriggersService } from "@modules/domain/provider-triggers"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { DELIVER_TEAM_CHAT_TAG_JOB, TEAM_CHAT_TAG_QUEUE } from "@modules/queues/team-chat-tag"
import { TeamChatTagDeliveryService } from "./team-chat-tag-delivery.service"
import { TeamChatTagsService } from "./team-chat-tags.service"

const WS = "11111111-1111-4111-8111-111111111111"
const TAG = {
    userId: "22222222-2222-4222-8222-222222222222",
    agentId: "33333333-3333-4333-8333-333333333333",
    roomId: "44444444-4444-4444-8444-444444444444",
    messageId: "55555555-5555-4555-8555-555555555555",
    text: "@bot quote",
}

/** The process "dies" here: the error a call throws when its worker is gone before the call's outcome is known. */
const killed = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

const build = async () => {
    const tx = fakeTransaction(mockEntityManager({}))
    const ownership = mock<AgentOwnershipService>()
    ownership.memberIdOf.mockResolvedValue("seat-1")
    ownership.canAssign.mockResolvedValue(true)
    const outbox = recordingQueueOutbox()
    const write = jest.spyOn(outbox, "write")
    const triggers = mock<ProviderTriggersService>()
    triggers.deliver.mockResolvedValue({ status: "delivered", events: 1, dropped: 0, sameFact: 0, woken: [], repeats: 0, untaken: 0, held: 0 })
    const moduleRef = await Test.createTestingModule({
        providers: [
            TeamChatTagsService,
            TeamChatTagDeliveryService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: tx.em },
            { provide: QUEUE_OUTBOX, useValue: outbox },
            { provide: AgentOwnershipService, useValue: ownership },
            { provide: ProviderTriggersService, useValue: triggers },
        ],
    }).compile()
    return { tags: moduleRef.get(TeamChatTagsService), delivery: moduleRef.get(TeamChatTagDeliveryService), triggers, write, tx: tx.em }
}

describe("team chat tag chain: the job is run twice, the second run repeats no finished step and no settled effect", () => {
    it("the hand-off of one message and agent written twice (a client retry after a kill) is ONE job: the once key is the dedupe key both times", async () => {
        const t = await build()

        await t.tags.handOff(t.tx, WS, TAG)
        await t.tags.handOff(t.tx, WS, TAG)

        // The kit's outbox double types a write as (tx, queue, payload); the producer also passes the write options (4th argument).
        const keys = t.write.mock.calls.map((call) => (call as ReadonlyArray<{ readonly dedupeKey?: string } | undefined>)[3]?.dedupeKey)
        expect(keys).toEqual([`team-chat-tag:${TAG.messageId}:${TAG.agentId}`, `team-chat-tag:${TAG.messageId}:${TAG.agentId}`])
        const payload = t.write.mock.calls[0]?.[2]
        expect(payload).toBeDefined()
        expect(DELIVER_TEAM_CHAT_TAG_JOB.onceKey(payload as never)).toBe(keys[0])
        expect(t.write.mock.calls[0]?.[1]).toBe(TEAM_CHAT_TAG_QUEUE)
    })

    it("a kill after the event was handed over and before the job settled: the second run hands the SAME event id again, which the pipeline counts as a repeat and wakes nobody twice", async () => {
        const t = await build()
        await t.tags.handOff(t.tx, WS, TAG)
        const payload = t.write.mock.calls[0]?.[2] as object

        t.triggers.deliver.mockRejectedValueOnce(killed())
        await expect(t.delivery.deliverJob(payload)).rejects.toMatchObject({ code: "ECONNRESET" })
        t.triggers.deliver.mockResolvedValueOnce({ status: "delivered", events: 0, dropped: 0, sameFact: 0, woken: [], repeats: 1, untaken: 0, held: 0 })
        await t.delivery.deliverJob(payload)

        const ids = t.triggers.deliver.mock.calls.map((call) => call[0].events[0]?.event.id)
        expect(ids).toEqual([`chat-tag:${TAG.messageId}:${TAG.agentId}`, `chat-tag:${TAG.messageId}:${TAG.agentId}`])
    })
})
