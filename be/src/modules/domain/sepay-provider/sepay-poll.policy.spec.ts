import { Test } from "@nestjs/testing"
import { bankTransactionValueOf } from "@modules/domain/bank-feed-inbox"
import { sepayBankTransaction, sepayPolledRow } from "./sepay-poll.policy"
import type { SepayTransaction } from "@modules/integrations/sepay"

const SUBJECT = Symbol("sepay-poll.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { sepayBankTransaction, sepayPolledRow } }],
    }).compile()
    return moduleRef.get<{
        sepayBankTransaction: typeof sepayBankTransaction
        sepayPolledRow: typeof sepayPolledRow
    }>(SUBJECT)
}

/** The transfer the owner made on 2026-11-04 01:06: SePay transaction 95958515, +5000 into account 525209999. */
const REAL: SepayTransaction = {
    id: "95958515",
    occurredAt: new Date("2026-11-03T18:06:00.000Z"),
    amountIn: 5000,
    amountOut: 0,
    content: "BUI NGUYEN DINH Test sepay Chuyen tien dat chau hoa- Ma GD ACSP/ 7o940",
    code: null,
    bank: "MBBank",
}

describe("sepayPolledRow", () => {
    it("maps a real transfer to the transaction row the webhook keeps for the same transaction (same key), read by the poll", async () => {
        const subject = await build()

        expect(subject.sepayPolledRow(REAL, "0123456789")).toEqual({
            value: {
                transactionId: "sepay:95958515",
                amount: 5000,
                direction: "credit",
                content: "BUI NGUYEN DINH Test sepay Chuyen tien dat chau hoa- Ma GD ACSP/ 7o940",
                account: "0123456789",
                at: "2026-11-03T18:06:00.000Z",
                source: "poll",
            },
            at: new Date("2026-11-03T18:06:00.000Z"),
        })
    })

    it("is the row the webhook builder makes of the same credit, but for the source word", async () => {
        const subject = await build()
        const webhookValue = bankTransactionValueOf(
            {
                amount: 5000,
                content: "BUI NGUYEN DINH Test sepay Chuyen tien dat chau hoa- Ma GD ACSP/ 7o940",
                eventId: "sepay:95958515",
                fallbackBankName: "MBBank",
                account: "0123456789",
                occurredAt: "2026-11-03T18:06:00.000Z",
            },
            "webhook",
        )

        expect({ ...subject.sepayPolledRow(REAL, "0123456789")?.value, source: "webhook" }).toEqual(webhookValue)
    })

    it("keeps the row's bank reference and its own account number, under the unchanged transaction id", async () => {
        const subject = await build()

        const row = { ...REAL, reference: "FT25308XYZ", account: "525209999" }
        expect(subject.sepayPolledRow(row, "0123456789")?.value).toMatchObject({
            transactionId: "sepay:95958515",
            account: "525209999",
            bankRef: "FT25308XYZ",
        })
    })

    it("falls back to the connection's account and adds no reference when the row names neither", async () => {
        const subject = await build()

        const value = subject.sepayPolledRow(REAL, "0123456789")?.value
        expect(value).toMatchObject({ account: "0123456789", transactionId: "sepay:95958515" })
        expect(value).not.toHaveProperty("bankRef")
    })

    it("maps money out to a debit", async () => {
        const subject = await build()

        expect(subject.sepayPolledRow({ ...REAL, amountIn: 0, amountOut: 120 }, "0123456789")?.value).toMatchObject({
            amount: 120,
            direction: "debit",
        })
    })

    it("falls back to the code for the content", async () => {
        const subject = await build()

        expect(subject.sepayPolledRow({ ...REAL, content: "", code: "DH7", bank: null }, "0123456789")?.value).toMatchObject({
            content: "DH7",
        })
        expect(subject.sepayPolledRow({ ...REAL, content: "", code: null }, "0123456789")?.value).toMatchObject({ content: "" })
    })

    it("maps a row that moved no money to nothing", async () => {
        const subject = await build()

        expect(subject.sepayPolledRow({ ...REAL, amountIn: 0 }, "0123456789")).toBeUndefined()
    })
})

describe("sepayBankTransaction", () => {
    it("maps the real transfer to the bank-feed shape", async () => {
        const subject = await build()

        expect(subject.sepayBankTransaction(REAL)).toEqual({
            id: "sepay:95958515",
            direction: "credit",
            amountVnd: 5000,
            content: "BUI NGUYEN DINH Test sepay Chuyen tien dat chau hoa- Ma GD ACSP/ 7o940",
            occurredAt: "2026-11-03T18:06:00.000Z",
            bankName: "MBBank",
        })
    })

    it("maps money out to a debit and falls back to the code and to SePay", async () => {
        const subject = await build()

        expect(
            subject.sepayBankTransaction({
                ...REAL,
                amountIn: 0,
                amountOut: 120,
                content: "",
                code: "DH7",
                bank: null,
            }),
        ).toMatchObject({
            direction: "debit",
            amountVnd: 120,
            content: "DH7",
            bankName: "SePay",
        })
        expect(subject.sepayBankTransaction({ ...REAL, content: "", code: null })?.content).toBe("")
    })

    it("maps a row that moved no money to nothing", async () => {
        const subject = await build()

        expect(subject.sepayBankTransaction({ ...REAL, amountIn: 0 })).toBeUndefined()
    })
})
