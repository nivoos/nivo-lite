import { Test } from "@nestjs/testing"
import { mockEntityManager, recordingQueueOutbox } from "@starci/jest-preset"
import { AccountDataAdmissionsService } from "@modules/domain/account-data"
import { QUEUE_OUTBOX } from "@modules/platform/queue"
import { BANK_FEED_DELIVERY_QUEUE } from "@modules/queues/bank-feed-delivery"
import { BankFeedAdmissionService } from "./bank-feed-admission.service"

const CONNECTION = "0b8e6f4a-6c1e-4d47-9a51-1f3c2b7d9e10"
const owner = (provider: string) => ({ provider, connectionId: CONNECTION, workspaceId: "ws-1" })

const build = async () => {
    const outbox = recordingQueueOutbox()
    const write = jest.spyOn(outbox, "write")
    const moduleRef = await Test.createTestingModule({
        providers: [BankFeedAdmissionService, AccountDataAdmissionsService, { provide: QUEUE_OUTBOX, useValue: outbox }],
    }).compile()
    const admissions = moduleRef.get(AccountDataAdmissionsService)
    moduleRef.get(BankFeedAdmissionService).onModuleInit()
    return { admissions, outbox, write, tx: mockEntityManager() }
}

describe("BankFeedAdmissionService", () => {
    it("registers one admission for each bank transaction type, and for no other", async () => {
        const { admissions } = await build()

        expect(["sepay.transaction", "casso.transaction", "payos.transaction"].map((type) => admissions.has(type))).toEqual([true, true, true])
        expect(admissions.has("sepay.delivery")).toBe(false)
        expect(admissions.has("telegram.update")).toBe(false)
    })

    it.each([
        ["sepay-feed", "sepay", "sepay.transaction"],
        ["casso", "casso", "casso.transaction"],
        ["payos", "payos", "payos.transaction"],
    ] as const)("queues the delivery job of a new %s movement in the caller's transaction under its connection-scoped once-key", async (door, provider, type) => {
        const { admissions, write, tx } = await build()

        await admissions.admit(tx, { id: "row-1", type, key: "tx:9", owner: owner(provider), value: {} })

        expect(write).toHaveBeenCalledWith(
            tx,
            BANK_FEED_DELIVERY_QUEUE,
            { provider: door, deliveryId: `${CONNECTION}:tx:9` },
            { job: "bank-feed-delivery", dedupeKey: `bank-feed-delivery:${door}:${CONNECTION}:tx:9` },
        )
    })

    it("queues one job for one admission: the poll's new row and the door's new row use the same road", async () => {
        const { admissions, outbox, tx } = await build()

        await admissions.admit(tx, { id: "row-1", type: "sepay.transaction", key: "sepay:1", owner: owner("sepay"), value: {} })

        expect(outbox.jobs).toHaveLength(1)
    })

    it("fails the admission (so the row's transaction rolls back) when the job cannot be written", async () => {
        const { admissions, outbox, tx } = await build()
        const down = new Error("outbox down")
        outbox.failNext("write", down)

        await expect(
            admissions.admit(tx, { id: "row-1", type: "casso.transaction", key: "casso:1", owner: owner("casso"), value: {} }),
        ).rejects.toBe(down)
    })
})
