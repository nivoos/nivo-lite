import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { EntityManager } from "typeorm"
import {
    AccountDataAdmissionsService,
    AccountDataIntakeService,
    type AccountOwner,
    type AccountWrite,
} from "@modules/domain/account-data"
import type { ConnectionRecord } from "@modules/domain/connections"
import type { PolledRow } from "@modules/domain/provider-registry"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { pollConnectionRecordOf } from "@tests/fixtures/builders/connection-poll.builder"
import { PollReceiptsService } from "./poll-receipts.service"

const TYPE = "sepay.transaction"
const OWNER: AccountOwner = { provider: "sepay", connectionId: "c-1", workspaceId: "ws-1" }
const T1 = new Date("2026-11-04T08:00:00.000Z")
const T2 = new Date("2026-11-04T09:00:00.000Z")
const T3 = new Date("2026-11-04T09:30:00.000Z")

const rowOf = (id: string, at: Date | null): PolledRow => ({ value: { id, amount: 100 }, at })
const idOf = (input: { readonly value: object }): string => String(Reflect.get(input.value, "id"))

/** One entry of the intake's answer. */
type WrittenRow = AccountWrite["rows"][number]

/** What the intake answers for one input: a new row of its id, or an existing one (no id). */
const answer = (isNew: boolean, id: string): WrittenRow => ({ type: TYPE, key: `key-${id}`, id: isNew ? `row-${id}` : "", isNew })

const build = async (isNew: (id: string) => boolean = () => true, owner: AccountOwner | null = OWNER) => {
    const tx = { marker: "tx" } as unknown as EntityManager
    const transaction = jest.fn((run: (manager: EntityManager) => Promise<boolean>) => run(tx))
    const intake = mock<AccountDataIntakeService>()
    const written: Array<string> = []
    intake.write.mockImplementation((_tx, _connectionId, inputs) => {
        const input = inputs[0]
        const id = input === undefined ? "" : idOf(input)
        written.push(id)
        const result: AccountWrite = owner === null ? { owner: null, rows: [] } : { owner, rows: [answer(isNew(id), id)] }
        return Promise.resolve(result)
    })
    const admissions = mock<AccountDataAdmissionsService>()
    admissions.admit.mockResolvedValue(undefined)
    const moduleRef = await Test.createTestingModule({
        providers: [
            PollReceiptsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: { transaction } },
            { provide: AccountDataIntakeService, useValue: intake },
            { provide: AccountDataAdmissionsService, useValue: admissions },
        ],
    }).compile()
    return { receipts: moduleRef.get(PollReceiptsService), intake, admissions, transaction, tx, written }
}

const account: ConnectionRecord = pollConnectionRecordOf()

describe("PollReceiptsService the order rows are written in", () => {
    it("writes the rows oldest first whatever order the pages came in (pages are read newest first)", async () => {
        const { receipts, written } = await build()

        await receipts.keep(account, TYPE, [rowOf("new", T3), rowOf("mid", T2), rowOf("old", T1)])

        expect(written).toEqual(["old", "mid", "new"])
    })

    it("writes the rows of a walk oldest first when a later page holds an older row than an earlier one", async () => {
        const { receipts, written } = await build()

        await receipts.keep(account, TYPE, [rowOf("p1-new", T3), rowOf("p1-old", T2), rowOf("p2-new", T2), rowOf("p2-old", T1)])

        expect(written[0]).toBe("p2-old")
        expect(written[written.length - 1]).toBe("p1-new")
    })

    it("keeps a row with no time after the timed rows it was read with", async () => {
        const { receipts, written } = await build()

        await receipts.keep(account, TYPE, [rowOf("undated", null), rowOf("new", T2), rowOf("old", T1)])

        expect(written).toEqual(["old", "new", "undated"])
    })

    it("opens one transaction per row, in sequence", async () => {
        const { receipts, transaction } = await build()

        await receipts.keep(account, TYPE, [rowOf("a", T1), rowOf("b", T2), rowOf("c", T3)])

        expect(transaction).toHaveBeenCalledTimes(3)
    })
})

describe("PollReceiptsService a new row", () => {
    it("is written under the account's connection and type and admitted in the same transaction with its id, type, key, owner and the value unchanged", async () => {
        const { receipts, intake, admissions, tx } = await build()
        const row = rowOf("a", T1)

        await expect(receipts.keep(account, TYPE, [row])).resolves.toBe(1)

        expect(intake.write).toHaveBeenCalledWith(tx, "c-1", [{ type: TYPE, value: row.value }])
        expect(admissions.admit).toHaveBeenCalledTimes(1)
        expect(admissions.admit).toHaveBeenCalledWith(tx, { id: "row-a", type: TYPE, key: "key-a", owner: OWNER, value: row.value })
        const admitted = admissions.admit.mock.calls[0]?.[1]
        expect(admitted?.value).toBe(row.value)
    })

    it("is admitted after it was written", async () => {
        const { receipts, intake, admissions } = await build()

        await receipts.keep(account, TYPE, [rowOf("a", T1)])

        expect(intake.write.mock.invocationCallOrder[0]).toBeLessThan(admissions.admit.mock.invocationCallOrder[0] ?? 0)
    })
})

describe("PollReceiptsService a row that is already kept", () => {
    it("is nothing: not admitted and not counted (the webhook or an earlier poll brought it first)", async () => {
        const { receipts, admissions } = await build(() => false)

        await expect(receipts.keep(account, TYPE, [rowOf("a", T1), rowOf("b", T2)])).resolves.toBe(0)

        expect(admissions.admit).not.toHaveBeenCalled()
    })

    it("admits only the new rows of a mixed walk and counts them", async () => {
        const { receipts, admissions } = await build((id) => id !== "b")

        await expect(receipts.keep(account, TYPE, [rowOf("a", T1), rowOf("b", T2), rowOf("c", T3)])).resolves.toBe(2)

        expect(admissions.admit.mock.calls.map(([, row]) => row.key)).toEqual(["key-a", "key-c"])
    })
})

describe("PollReceiptsService an account the intake does not know", () => {
    it("writes nothing, admits nothing and counts nothing", async () => {
        const { receipts, admissions } = await build(() => true, null)

        await expect(receipts.keep(account, TYPE, [rowOf("a", T1)])).resolves.toBe(0)

        expect(admissions.admit).not.toHaveBeenCalled()
    })
})

describe("PollReceiptsService a walk with no rows", () => {
    it("opens no transaction and counts nothing", async () => {
        const { receipts, transaction, intake } = await build()

        await expect(receipts.keep(account, TYPE, [])).resolves.toBe(0)

        expect(transaction).not.toHaveBeenCalled()
        expect(intake.write).not.toHaveBeenCalled()
    })
})

describe("PollReceiptsService a failing admission", () => {
    it("fails the walk with the admission's error (its transaction rolls back) and writes no later row", async () => {
        const { receipts, admissions, written } = await build()
        admissions.admit.mockRejectedValue(new Error("consumer queue down"))

        await expect(receipts.keep(account, TYPE, [rowOf("a", T1), rowOf("b", T2)])).rejects.toThrow("consumer queue down")

        expect(written).toEqual(["a"])
    })
})
