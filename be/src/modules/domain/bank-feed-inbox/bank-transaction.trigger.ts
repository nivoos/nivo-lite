import { PROVIDER, TRIGGER } from "@nivo-lite/agent-sdk/names"
import { z } from "zod"
import type { OptionalCanonicalEvent, TriggerDeclaration } from "@modules/domain/provider-triggers"
import { BANK_TRANSACTION_WORDS, CASSO_WITHOUT_POLL, PAYOS_WITHOUT_POLL } from "./bank-transaction.words"
import type { BankFeedProvider } from "./bank-feed-inbox.contracts"
import { transactionTypeOf } from "./bank-feed.normalise.policy"

/*
 * THE BANK FEEDS' TRANSACTION TRIGGER (stage 1 of the one event pipeline, concept triggers rule 13): one movement of a bank account, as
 * every bank feed (SePay, Casso, payOS) reports it, as ONE canonical event per movement. Its raw is the `<provider>.transaction` row the
 * feed's intake kept (one shape for the three feeds, keyed by the provider's own transaction id: a webhook delivery and the reconcile poll
 * of the same movement are one row). Pure: the translate reads only its argument. A credit is the movement IN: the engine derives
 * `payment.credit.received` registrations with `data.direction = in` (trigger-specs `CREDITS_ONLY`), so the trigger keeps both directions,
 * as before.
 */

/** The trigger's name inside each bank feed. */
export const BANK_TRANSACTION_RECEIVED = "transaction.received"

/** The data of one movement: the provider's id of it, its direction, and the facts every feed's row holds (absent when the row lacks one). */
export type BankTransactionData = {
    /** The provider's own id of the movement (the row's key). */
    readonly transactionId: string
    /** Money in or out. */
    readonly direction: "in" | "out"
    /** The amount in VND, a whole number. */
    readonly amountVnd: number
    /** The transfer content the bank shows. */
    readonly content: string
    /** When the bank booked it (ISO 8601), when the feed says. */
    readonly at?: string | undefined
    /** The bank account it moved on, when the feed names it. */
    readonly account?: string | undefined
    /** The bank's own reference, when the feed gives one. */
    readonly bankRef?: string | undefined
    /**
     * What the provider identifies the payment by, as its feed declares it (owner ruling R111): the payment request's own reference when the
     * provider names the request a movement pays (payOS: the order code), else the transfer content the payer wrote (a bank-transfer
     * instruction keeps no request). A payment request answers the same `payKey`, so a wait matches the two.
     */
    readonly payKey: string
}

/** The `<provider>.transaction` row value (bank-feed.data-types.ts `transactionOf`). The translate's raw. */
export interface BankTransactionRow {
    /** The provider's own id of the movement (the row's key); empty when the feed gave none. */
    readonly transactionId: string
    /** The amount of the movement in VND. */
    readonly amount: number
    /** The feed's direction word; `debit` is money out, anything else is money in. */
    readonly direction: string
    /** The transfer content the bank shows. */
    readonly content: string
    /** The bank account it moved on, when the feed names it. */
    readonly account?: string | undefined
    /** The counterparty that sent the money, when the feed names it. */
    readonly payer?: string | undefined
    /** The bank's own reference, when the feed gives one. */
    readonly bankRef?: string | undefined
    /** The provider's own reference of the payment request the movement pays, when the feed names one. */
    readonly requestRef?: string | undefined
    /** When the bank booked it (ISO 8601), when the feed says. */
    readonly at?: string | undefined
    /** The feed that reported the movement (its provider name). */
    readonly source: string
}

/** Which member of a stored movement a feed identifies the payment by (`BankTransactionData.payKey`). */
type PayKeyMember = "content" | "requestRef"

/**
 * The translate of a feed: the movement of one stored row; null for a row with no id. `payKey` is the member the feed declares; a row that
 * lacks it (a payOS movement of no named request) carries none, so it matches no request.
 */
export const translateBankTransactionRow = (row: BankTransactionRow, payKeyBy: PayKeyMember = "content"): OptionalCanonicalEvent<BankTransactionData> => {
    if (row.transactionId === "") return null
    const payKey = row[payKeyBy] ?? ""
    return {
        id: row.transactionId,
        data: {
            transactionId: row.transactionId,
            direction: row.direction === "debit" ? "out" : "in",
            amountVnd: row.amount,
            content: row.content,
            ...(row.at === undefined ? {} : { at: row.at }),
            ...(row.account === undefined ? {} : { account: row.account }),
            ...(row.bankRef === undefined ? {} : { bankRef: row.bankRef }),
            payKey,
        },
    }
}

/** The bounds the stored `<provider>.transaction` row holds (bank-feed.data-types.ts `transactionOf`): the schemas below accept what the row can hold. */
const ID_MAX = 400
const CONTENT_MAX = 2000
const DIRECTION_MAX = 6
const ACCOUNT_MAX = 64
const PAYER_MAX = 256
const SOURCE_MAX = 8
/** An ISO 8601 timestamp is far shorter. */
const AT_MAX = 64

/** The data schema of one movement. */
const BANK_TRANSACTION_DATA: z.ZodType<BankTransactionData> = z.object({
    transactionId: z.string().min(1).max(ID_MAX),
    direction: z.enum(["in", "out"]),
    amountVnd: z.number().int(),
    content: z.string().max(CONTENT_MAX),
    at: z.string().max(AT_MAX).optional(),
    account: z.string().max(ACCOUNT_MAX).optional(),
    bankRef: z.string().max(ID_MAX).optional(),
    payKey: z.string().max(CONTENT_MAX),
})

/** The raw schema: the stored transaction row value. */
const BANK_TRANSACTION_ROW: z.ZodType<BankTransactionRow> = z.object({
    transactionId: z.string().max(ID_MAX),
    amount: z.number(),
    direction: z.string().max(DIRECTION_MAX),
    content: z.string().max(CONTENT_MAX),
    account: z.string().max(ACCOUNT_MAX).optional(),
    payer: z.string().max(PAYER_MAX).optional(),
    bankRef: z.string().max(ID_MAX).optional(),
    requestRef: z.string().max(ID_MAX).optional(),
    at: z.string().max(AT_MAX).optional(),
    source: z.string().max(SOURCE_MAX),
})

/**
 * The source's own identity of the fact one movement reports (owner R97): the bank account it moved on and the BANK's own reference of it,
 * both read from the parsed data, joined as the two source-given members. Two feeds of one bank account (SePay and Casso) that both pass the
 * bank's reference on report one transfer under one key, so the engine wakes once. A movement missing either member has no fact key (it is its
 * own fact): never a hash, never the amount or the words. NOT VERIFIED that two feeds give the same reference (see the notes of TL-S3):
 * the cost of a mismatch is a second wake, which every downstream write is safe to re-run for, never a lost one.
 */
export const bankTransactionFactKey = (data: BankTransactionData): string | null =>
    data.account === undefined || data.account === "" || data.bankRef === undefined || data.bankRef === ""
        ? null
        : `${data.account}:${data.bankRef}`

/** One bank feed: its door (the claim name its movements are kept under) and how it receives the movement, with the reason a missed one needs no poll when it has none. */
interface BankFeed {
    readonly door: BankFeedProvider
    readonly via: TriggerDeclaration["via"]
    readonly withoutPoll?: TriggerDeclaration["withoutPoll"]
    /** What the provider identifies a payment by (`payKey`): its payment request's reference, or the transfer content. */
    readonly payKey: PayKeyMember
}

/** The bank feeds that report a movement as this trigger: SePay by its webhook and its transactions list; Casso and payOS by their webhook only. */
const FEEDS: Readonly<Record<string, BankFeed>> = {
    [PROVIDER.sepay]: { door: "sepay-feed", via: ["webhook", "poll"], payKey: "content" },
    [PROVIDER.casso]: { door: "casso", via: ["webhook"], withoutPoll: CASSO_WITHOUT_POLL, payKey: "content" },
    [PROVIDER.payos]: { door: "payos", via: ["webhook"], withoutPoll: PAYOS_WITHOUT_POLL, payKey: "requestRef" },
}

/** The bank feeds that report a movement as this trigger. */
export const BANK_TRANSACTION_PROVIDERS: ReadonlyArray<string> = Object.keys(FEEDS)

/** The account_data type one bank feed keeps its movements as (`sepay.transaction`); a provider that is no bank feed is a wiring error. */
export const bankTransactionTypeOf = (provider: string): string => {
    const feed = FEEDS[provider]
    if (feed === undefined) throw new Error(`no bank feed named ${provider}`)
    return transactionTypeOf(feed.door)
}

/** The door a bank feed's movements are kept under (the claim name of its webhook door); a provider that is no bank feed is a wiring error. */
export const bankDoorOf = (provider: string): BankFeedProvider => {
    const feed = FEEDS[provider]
    if (feed === undefined) throw new Error(`no bank feed named ${provider}`)
    return feed.door
}

/** One feed's transaction trigger: received by its webhook (and, where a receiver exists, its poll), keyed by the transaction, on the owner's switch (off until switched on). */
const bankTransactionTriggerOf = (provider: string, feed: BankFeed): TriggerDeclaration<BankTransactionRow, BankTransactionData> => ({
    provider,
    name: BANK_TRANSACTION_RECEIVED,
    verb: TRIGGER.paymentCreditReceived,
    via: feed.via,
    ...(feed.withoutPoll === undefined ? {} : { withoutPoll: feed.withoutPoll }),
    words: BANK_TRANSACTION_WORDS,
    switch: { decided: true, onByDefault: false },
    dataType: transactionTypeOf(feed.door),
    raw: BANK_TRANSACTION_ROW,
    data: BANK_TRANSACTION_DATA,
    translate: (row) => translateBankTransactionRow(row, feed.payKey),
    factKey: bankTransactionFactKey,
    key: { by: "data", member: "transactionId" },
    settle: null,
})

/** Every bank feed's transaction trigger. */
export const BANK_TRANSACTION_TRIGGERS: ReadonlyArray<TriggerDeclaration<BankTransactionRow, BankTransactionData>> =
    Object.entries(FEEDS).map(([provider, feed]) => bankTransactionTriggerOf(provider, feed))

/** The transaction trigger of one bank feed, or null for a provider that is no bank feed. */
export const bankTransactionTriggerFor = (
    provider: string,
): TriggerDeclaration<BankTransactionRow, BankTransactionData> | null =>
    BANK_TRANSACTION_TRIGGERS.find((declaration) => declaration.provider === provider) ?? null
