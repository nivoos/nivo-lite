import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { BACKUP_DATA_JOB, BACKUP_DUE_JOB, DataCopiesQueue, VERIFY_DATA_JOB } from "@modules/queues/data-copies"
import { NIVO_SET } from "@tests/fixtures/builders/data-copies.builder"
import { DataBackupDueService } from "./data-backup-due.service"
import type { DataSetDeclaration } from "./data-copies.contracts"
import { DATA_SET_LIST } from "./data-copies.decorators"
import { backupSlotOf } from "./data-backup-config.policy"

const HOURLY: DataSetDeclaration = {
    id: "hourly-set",
    purpose: "seed-backup",
    stores: ["database"],
    drivers: ["git-copy"],
    everyMinutes: 60,
}

const build = async (sets: ReadonlyArray<DataSetDeclaration>, at: string) => {
    const em = mockEntityManager()
    const transaction = fakeTransaction(em)
    const queue = mock<DataCopiesQueue>()
    queue.enqueueBackup.mockResolvedValue(undefined)
    const moduleRef = await Test.createTestingModule({
        providers: [
            DataBackupDueService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: CLOCK, useValue: new FakeClock(at) },
            { provide: DATA_SET_LIST, useValue: [...sets] },
            { provide: DataCopiesQueue, useValue: queue },
        ],
    }).compile()
    return { service: moduleRef.get(DataBackupDueService), queue, transaction }
}

describe("DataBackupDueService: one job per data set and slot", () => {
    it("queues one backup for each set in the slot its schedule is in, all in one transaction", async () => {
        const t = await build([NIVO_SET, HOURLY], "2026-11-14T10:20:00.000Z")

        await expect(t.service.queueDue()).resolves.toBe(2)

        const now = new Date("2026-11-14T10:20:00.000Z")
        expect(t.queue.enqueueBackup.mock.calls.map(([payload]) => payload)).toEqual([
            { setId: "nivo-lite", slot: backupSlotOf(NIVO_SET, now) },
            { setId: "hourly-set", slot: backupSlotOf(HOURLY, now) },
        ])
        expect(t.transaction.commits).toBe(1)
    })

    it("queues nothing, and answers zero, when no data set is declared", async () => {
        const t = await build([], "2026-11-14T10:20:00.000Z")

        await expect(t.service.queueDue()).resolves.toBe(0)

        expect(t.queue.enqueueBackup).not.toHaveBeenCalled()
    })

    it("two ticks inside one period name one slot, so they write one dedupe key; the next period is another key", async () => {
        const first = await build([NIVO_SET], "2026-11-14T01:00:00.000Z")
        const second = await build([NIVO_SET], "2026-11-14T22:00:00.000Z")
        const next = await build([NIVO_SET], "2026-11-15T01:00:00.000Z")
        await Promise.all([first.service.queueDue(), second.service.queueDue(), next.service.queueDue()])

        const keys = [first, second, next].map((t) => {
            const [payload] = t.queue.enqueueBackup.mock.calls[0] ?? []
            return payload === undefined ? "" : BACKUP_DATA_JOB.onceKey(payload)
        })

        expect(keys[0]).toBe(keys[1])
        expect(keys[2]).not.toBe(keys[0])
        expect(keys[0]).toBe(
            BACKUP_DATA_JOB.onceKey({
                setId: "nivo-lite",
                slot: backupSlotOf(NIVO_SET, new Date("2026-11-14T01:00:00.000Z")),
            }),
        )
    })
})

describe("the ticks of the data copy jobs", () => {
    it("carry the tick payload, once each, under the job names the platform ticks write", () => {
        expect(BACKUP_DUE_JOB.name).toBe("data.backup-due")
        expect(VERIFY_DATA_JOB.name).toBe("data.verify")
        expect(BACKUP_DUE_JOB.payload({ tick: true })).toBe(true)
        expect(VERIFY_DATA_JOB.payload({ tick: true })).toBe(true)
        expect(BACKUP_DUE_JOB.payload({})).toBe(false)
    })
})
