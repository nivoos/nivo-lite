import type { AccountDataInput, AccountDataTypeDef } from "@modules/domain/account-data"
import type { BankFeedProvider, IncomingCredit } from "./bank-feed-inbox.contracts"
import { cassoTransaction, payosTransaction, sepayTransaction } from "./bank-feed.data-types"

/** The type a bank door keeps: one bank movement as the provider reported it. */
interface BankFeedTypes {
    /** One bank movement as the provider reported it. */
    readonly transaction: AccountDataTypeDef
}

/** The types each bank door writes, by the door's claim name. */
const TYPES_OF_DOOR: Readonly<Record<BankFeedProvider, BankFeedTypes>> = {
    "sepay-feed": { transaction: sepayTransaction },
    casso: { transaction: cassoTransaction },
    payos: { transaction: payosTransaction },
}

/** Which way a movement reached NIVO: a provider's webhook, or the poll that read it back. */
export type BankMovementSource = "webhook" | "poll"

/** The type name of the movements a bank door keeps (`sepay.transaction`, `casso.transaction`, `payos.transaction`). */
export const transactionTypeOf = (door: BankFeedProvider): string => TYPES_OF_DOOR[door].transaction.name

/** When the bank booked a movement, as ISO text, when the provider says a valid time. */
const atOf = (credit: IncomingCredit): string | undefined => {
    if (credit.occurredAt === undefined) return undefined
    const at = new Date(credit.occurredAt)
    return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

/**
 * The `<provider>.transaction` value of one movement: the ONE builder the webhook doors and every poll receiver use, so a movement the
 * webhook kept and the same movement the poll read are the same row (the provider's own id is the key).
 */
export const bankTransactionValueOf = (credit: IncomingCredit, source: BankMovementSource): Readonly<Record<string, unknown>> => {
    const at = atOf(credit)
    return {
        transactionId: credit.eventId,
        amount: Math.round(credit.amount),
        direction: credit.direction === "debit" ? "debit" : "credit",
        content: credit.content,
        ...(credit.account === undefined ? {} : { account: credit.account }),
        ...(credit.payer === undefined ? {} : { payer: credit.payer }),
        ...(credit.bankRef === undefined ? {} : { bankRef: credit.bankRef }),
        ...(at === undefined ? {} : { at }),
        source,
    }
}

/** The transaction rows of a door's movements, one per movement, keyed by the provider's own transaction id. */
export const feedTransactionRowsOf = (
    door: BankFeedProvider,
    credits: ReadonlyArray<IncomingCredit>,
    source: BankMovementSource,
): ReadonlyArray<AccountDataInput> =>
    credits.map((credit) => ({ type: transactionTypeOf(door), value: bankTransactionValueOf(credit, source) }))
