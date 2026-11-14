import { Test } from "@nestjs/testing"
import { mock, mockEntityManager } from "@starci/jest-preset"
import { AccountDataAdmissionsService, AccountDataIntakeService } from "@modules/domain/account-data"
import type { PendingRow } from "@modules/domain/account-data"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { BankFeedReceiptService } from "./bank-feed-inbox.service"
import { BankFeedInboxLogEvent } from "./bank-feed-inbox.log-events"

const CONNECTION = "0b8e6f4a-6c1e-4d47-9a51-1f3c2b7d9e10"
const DELIVERY = `${CONNECTION}:sepay:42`
const owner = { provider: "sepay", connectionId: CONNECTION, workspaceId: "ws-1" }
const credit = { amount: 1000, content: "payment", eventId: "sepay:42", fallbackBankName: "Bank" }
const value = { transactionId: "sepay:42", amount: 1000, direction: "credit", content: "payment", source: "webhook" }
const row: PendingRow = { id: "row-1", type: "sepay.transaction", key: "sepay:42", owner, value }
const written = (isNew: boolean, type = "sepay.transaction") => ({
    owner,
    rows: [{ type, key: "sepay:42", id: isNew ? "row-1" : "", isNew }],
})

const build = async () => {
    const manager = mockEntityManager()
    const intake = mock<AccountDataIntakeService>()
    intake.write.mockResolvedValue(written(true))
    intake.lockPending.mockResolvedValue(null)
    const admissions = mock<AccountDataAdmissionsService>()
    const logger = mock<Logger>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            BankFeedReceiptService,
            { provide: AccountDataIntakeService, useValue: intake },
            { provide: AccountDataAdmissionsService, useValue: admissions },
            { provide: LOGGER, useValue: logger },
        ],
    }).compile()
    return { service: moduleRef.get(BankFeedReceiptService), intake, admissions, logger, manager }
}

describe("BankFeedReceiptService keep", () => {
    it.each([
        ["sepay-feed", "sepay.transaction"],
        ["casso", "casso.transaction"],
        ["payos", "payos.transaction"],
    ] as const)("keeps a new %s movement as a %s row of the account and admits it in the same transaction", async (door, type) => {
        const { service, intake, admissions, manager } = await build()
        intake.write.mockResolvedValue(written(true, type))
        await expect(service.keep(manager, door, CONNECTION, [credit], "webhook")).resolves.toBe(1)
        expect(intake.write).toHaveBeenCalledWith(manager, CONNECTION, [{ type, value }])
        expect(admissions.admit).toHaveBeenCalledWith(manager, { id: "row-1", type, key: "sepay:42", owner, value })
    })

    it("admits nothing for a movement already kept (a repeat of the webhook, or the webhook after the poll)", async () => {
        const { service, intake, admissions, manager } = await build()
        intake.write.mockResolvedValue(written(false))
        await expect(service.keep(manager, "sepay-feed", CONNECTION, [credit], "webhook")).resolves.toBe(0)
        expect(admissions.admit).not.toHaveBeenCalled()
    })

    it("admits only the new ones of a delivery that holds several movements", async () => {
        const { service, intake, admissions, manager } = await build()
        intake.write.mockResolvedValue({
            owner,
            rows: [
                { type: "casso.transaction", key: "casso:1", id: "", isNew: false },
                { type: "casso.transaction", key: "casso:2", id: "row-2", isNew: true },
            ],
        })
        const credits = [
            { ...credit, eventId: "casso:1" },
            { ...credit, eventId: "casso:2" },
        ]
        await expect(service.keep(manager, "casso", CONNECTION, credits, "webhook")).resolves.toBe(1)
        expect(admissions.admit).toHaveBeenCalledTimes(1)
        expect(admissions.admit).toHaveBeenCalledWith(manager, expect.objectContaining({ id: "row-2", key: "casso:2" }))
    })

    it("keeps nothing and logs a connection nobody holds", async () => {
        const { service, intake, admissions, logger, manager } = await build()
        intake.write.mockResolvedValue({ owner: null, rows: [] })
        await expect(service.keep(manager, "casso", CONNECTION, [credit], "webhook")).resolves.toBe(0)
        expect(admissions.admit).not.toHaveBeenCalled()
        expect(logger.warn).toHaveBeenCalledWith(BankFeedInboxLogEvent.UnknownConnection, {
            provider: "casso",
            connection: CONNECTION,
        })
    })

    it("propagates a refused write or a refused admission to the transaction owner", async () => {
        const { service, intake, admissions, manager } = await build()
        const failure = new Error("write failed")
        intake.write.mockRejectedValueOnce(failure)
        await expect(service.keep(manager, "payos", CONNECTION, [credit], "webhook")).rejects.toBe(failure)
        admissions.admit.mockRejectedValueOnce(failure)
        await expect(service.keep(manager, "payos", CONNECTION, [credit], "webhook")).rejects.toBe(failure)
    })
})

describe("BankFeedReceiptService lock and complete", () => {
    it("locks the account's pending movement and answers its value", async () => {
        const { service, intake, manager } = await build()
        intake.lockPending.mockResolvedValue(row)
        await expect(service.lock(manager, "sepay-feed", DELIVERY)).resolves.toEqual({ value, owner, row })
        expect(intake.lockPending).toHaveBeenCalledWith(manager, "sepay.transaction", CONNECTION, "sepay:42")
    })

    it("returns undefined when no movement is pending", async () => {
        const { service, manager } = await build()
        await expect(service.lock(manager, "payos", DELIVERY)).resolves.toBeUndefined()
        await expect(service.lock(manager, "payos", "delivery-1")).resolves.toBeUndefined()
    })

    it("completes the locked movement row", async () => {
        const { service, intake, manager } = await build()
        await service.complete(manager, { value, owner, row })
        expect(intake.complete).toHaveBeenCalledWith(manager, row)
    })

    it("propagates a failed lock to the transaction owner", async () => {
        const { service, intake, manager } = await build()
        const failure = new Error("database failed")
        intake.lockPending.mockRejectedValue(failure)
        await expect(service.lock(manager, "payos", DELIVERY)).rejects.toBe(failure)
    })
})
