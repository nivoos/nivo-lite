import { Test } from "@nestjs/testing"
import { defineAccountDataType, schemaOf } from "@modules/domain/account-data"
import { BANK_FEED_DATA_TYPES } from "./bank-feed.data-types"
import {
    bankTransactionValueOf as realBankTransactionValueOf,
    feedTransactionRowsOf as realFeedTransactionRowsOf,
    transactionTypeOf as realTransactionTypeOf,
} from "./bank-feed.normalise.policy"

const SUBJECT = Symbol("bank-feed.normalise.policy")

type Subject = {
    bankTransactionValueOf: typeof realBankTransactionValueOf
    feedTransactionRowsOf: typeof realFeedTransactionRowsOf
    transactionTypeOf: typeof realTransactionTypeOf
}

const buildSubject = async (): Promise<Subject> => {
    const moduleRef = await Test.createTestingModule({
        providers: [
            {
                provide: SUBJECT,
                useValue: {
                    bankTransactionValueOf: realBankTransactionValueOf,
                    feedTransactionRowsOf: realFeedTransactionRowsOf,
                    transactionTypeOf: realTransactionTypeOf,
                },
            },
        ],
    }).compile()
    return moduleRef.get<Subject>(SUBJECT)
}

const doors = ["sepay-feed", "casso", "payos"] as const

/** A SePay transfer in, as the SePay door normalises it. */
const credit = {
    amount: 1000.4,
    content: "NIVO8F3K2",
    eventId: "sepay:9",
    fallbackBankName: "MBBank",
    account: "0123",
    payer: "An",
    bankRef: "FT9",
    occurredAt: "2026-11-05 14:02:37",
}
/** A transfer out with nothing optional. */
const debit = { amount: 50, content: "", eventId: "casso:3", fallbackBankName: "ACB", direction: "debit" as const }

const typeNamed = (name: string) => BANK_FEED_DATA_TYPES.find((def) => def.name === name)

/** Whether a value fits the declaration of its type; a type nobody declared fits nothing. */
const fitsDeclared = (type: string, value: object): boolean =>
    BANK_FEED_DATA_TYPES.filter((def) => def.name === type).some((def) => schemaOf(def).safeParse(value).success)

describe("bank-feed data types", () => {
    it("declares the six types, each passing defineAccountDataType again", () => {
        expect(BANK_FEED_DATA_TYPES.map((def) => def.name)).toEqual([
            "casso.delivery",
            "casso.transaction",
            "payos.delivery",
            "payos.transaction",
            "sepay.delivery",
            "sepay.transaction",
        ])
        BANK_FEED_DATA_TYPES.forEach((def) => expect(defineAccountDataType(def)).toEqual(def))
    })

    it("keeps the movement types waking: a new row is admitted, and the retired delivery types wake nothing", () => {
        expect(BANK_FEED_DATA_TYPES.filter((def) => def.wakes === true).map((def) => def.name)).toEqual([
            "casso.transaction",
            "payos.transaction",
            "sepay.transaction",
        ])
    })

    it.each(doors)("normalises the %s movements to values their declaration accepts", async (door) => {
        const { feedTransactionRowsOf } = await buildSubject()
        const rows = feedTransactionRowsOf(door, [credit, debit], "poll")
        expect(rows).toHaveLength(2)
        rows.forEach((row) => {
            const def = typeNamed(row.type)
            expect(def?.name.endsWith(".transaction")).toBe(true)
            expect(fitsDeclared(row.type, row.value)).toBe(true)
        })
    })
})

describe("bank-feed normalisers", () => {
    it("keeps each movement under the provider's own id, the amount whole and the time as ISO text", async () => {
        const { feedTransactionRowsOf } = await buildSubject()
        expect(feedTransactionRowsOf("sepay-feed", [credit, debit], "webhook")).toEqual([
            {
                type: "sepay.transaction",
                value: {
                    transactionId: "sepay:9",
                    amount: 1000,
                    direction: "credit",
                    content: "NIVO8F3K2",
                    account: "0123",
                    payer: "An",
                    bankRef: "FT9",
                    at: new Date("2026-11-05 14:02:37").toISOString(),
                    source: "webhook",
                },
            },
            {
                type: "sepay.transaction",
                value: { transactionId: "casso:3", amount: 50, direction: "debit", content: "", source: "webhook" },
            },
        ])
    })

    it("leaves out a time the bank did not say validly", async () => {
        const { feedTransactionRowsOf } = await buildSubject()
        const [row] = feedTransactionRowsOf("payos", [{ ...debit, occurredAt: "not a time" }], "webhook")
        expect(row?.value).not.toHaveProperty("at")
    })

    it("makes the same value for the webhook and for the poll of one movement, but for the source word", async () => {
        const { bankTransactionValueOf, transactionTypeOf } = await buildSubject()
        expect({ ...bankTransactionValueOf(credit, "poll"), source: "webhook" }).toEqual(bankTransactionValueOf(credit, "webhook"))
        expect(transactionTypeOf("sepay-feed")).toBe("sepay.transaction")
    })
})
