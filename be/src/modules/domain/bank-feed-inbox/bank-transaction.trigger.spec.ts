import { Test } from "@nestjs/testing"
import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import {
    BANK_TRANSACTION_TRIGGERS as realTriggers,
    bankTransactionTriggerFor as realTriggerFor,
    type BankTransactionRow,
} from "./bank-transaction.trigger"
import { feedTransactionRowsOf } from "./bank-feed.normalise.policy"

const SUBJECT = Symbol("bank-transaction.trigger")
type Subject = { triggers: typeof realTriggers; triggerFor: typeof realTriggerFor }

const buildSubject = async (): Promise<Subject> => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { triggers: realTriggers, triggerFor: realTriggerFor } }],
    }).compile()
    return moduleRef.get<Subject>(SUBJECT)
}

const ORIGIN = { connectionId: "conn-1" }

/** The row the feed's intake writes of one credit, made by the intake's own normaliser. */
const rowOf = (patch: Record<string, unknown> = {}): BankTransactionRow => {
    const [row] = feedTransactionRowsOf(
        "sepay-feed",
        [
            {
                amount: 150_000.4,
                content: "DH123 thanh toan",
                eventId: "tx-1",
                fallbackBankName: "VCB",
                account: "0123",
                bankRef: "FT1",
                occurredAt: "2026-11-14T01:00:00.000Z",
                ...patch,
            },
        ],
        "webhook",
    )
    return row?.value as unknown as BankTransactionRow
}

describe("the bank feeds' transaction trigger", () => {
    it("is declared once per bank feed, for the credit verb, keyed by the transaction, on the owner's switch", async () => {
        const { triggers, triggerFor } = await buildSubject()

        expect(triggers.map((one) => [one.provider, one.name, one.verb, one.via, one.dataType])).toEqual([
            [PROVIDER.sepay, "transaction.received", TRIGGER.paymentCreditReceived, ["webhook", "poll"], "sepay.transaction"],
            [PROVIDER.casso, "transaction.received", TRIGGER.paymentCreditReceived, ["webhook"], "casso.transaction"],
            [PROVIDER.payos, "transaction.received", TRIGGER.paymentCreditReceived, ["webhook"], "payos.transaction"],
        ])
        expect(triggers.every((one) => one.switch?.decided === true && one.switch.onByDefault === false)).toBe(true)
        expect(triggerFor(PROVIDER.sepay)?.key).toEqual({ by: "data", member: "transactionId" })
        expect(triggerFor("imap")).toBeNull()
        expect(triggerFor(PROVIDER.sepay)?.settle).toBeNull()
    })

    it("states why a webhook-only feed loses nothing: only SePay (a poll receiver) carries no reason, Casso quotes its re-delivery, payOS says NOT VERIFIED", async () => {
        const { triggerFor } = await buildSubject()

        expect(triggerFor(PROVIDER.sepay)?.withoutPoll).toBeUndefined()
        expect(triggerFor(PROVIDER.casso)?.withoutPoll?.source).toBe("https://developer.casso.vn/webhook/thiet-lap-webhook-thu-cong.md")
        expect(triggerFor(PROVIDER.casso)?.withoutPoll?.reason.en).toContain("Fibonacci")
        expect(triggerFor(PROVIDER.payos)?.withoutPoll?.reason.en).toContain("NOT VERIFIED")
    })

    it("words every member of its data, and never declares a line", async () => {
        const { triggers } = await buildSubject()
        const members = ["transactionId", "direction", "amountVnd", "content", "at", "account", "bankRef"]

        for (const one of triggers) {
            expect(Object.keys(one.words.members ?? {}).sort()).toEqual([...members].sort())
            expect(one.line).toBeUndefined()
        }
    })

    it("gives the fact key of a movement from the bank account and the bank's own reference, never from the amount or the words", async () => {
        const { triggerFor } = await buildSubject()
        const sepay = triggerFor(PROVIDER.sepay)
        const casso = triggerFor(PROVIDER.casso)
        const at = (patch: Record<string, unknown>) => sepay?.translate(rowOf(patch), ORIGIN)?.data

        expect(sepay?.factKey?.(at({}) as never)).toBe("0123:FT1")
        // The same transfer reported by another feed (another provider id, content, amount rounding): one fact.
        const other = casso?.translate({ ...rowOf({ eventId: "casso:77", content: "other words" }), source: "webhook" }, ORIGIN)?.data
        expect(casso?.factKey?.(other as never)).toBe("0123:FT1")
        // A different transfer of the same amount and words: another reference, another fact.
        expect(sepay?.factKey?.(at({ eventId: "tx-2", bankRef: "FT2" }) as never)).toBe("0123:FT2")
        // A movement without the bank's reference or the account is its own fact.
        expect(sepay?.factKey?.(at({ bankRef: undefined }) as never)).toBeNull()
        expect(sepay?.factKey?.(at({ account: undefined }) as never)).toBeNull()
    })

    it("translates the stored row of a credit into one event: the provider's id, money in, the facts of the row", async () => {
        const { triggerFor } = await buildSubject()
        const sepay = triggerFor(PROVIDER.sepay)

        expect(sepay?.translate(rowOf(), ORIGIN)).toEqual({
            id: "tx-1",
            data: {
                transactionId: "tx-1",
                direction: "in",
                amountVnd: 150_000,
                content: "DH123 thanh toan",
                at: "2026-11-14T01:00:00.000Z",
                account: "0123",
                bankRef: "FT1",
            },
        })
    })

    it("is pure (same row, same event, no subject: a movement names no person) and fits its schemas", async () => {
        const { triggerFor } = await buildSubject()
        const sepay = triggerFor(PROVIDER.sepay)
        const row = rowOf()

        const first = sepay?.translate(row, ORIGIN)
        expect(sepay?.translate(row, ORIGIN)).toEqual(first)
        expect(first?.subject).toBeUndefined()
        expect(sepay?.raw.safeParse(row).success).toBe(true)
        expect(sepay?.data.safeParse(first?.data).success).toBe(true)
    })

    it("keeps money out as `out` (the credit registrations narrow to `in`) and leaves out a fact the row lacks", async () => {
        const { triggerFor } = await buildSubject()

        const debit = triggerFor(PROVIDER.casso)?.translate(rowOf({ direction: "debit", account: undefined, bankRef: undefined, occurredAt: undefined }), ORIGIN)
        expect(debit?.data).toEqual({ transactionId: "tx-1", direction: "out", amountVnd: 150_000, content: "DH123 thanh toan" })
    })
})
