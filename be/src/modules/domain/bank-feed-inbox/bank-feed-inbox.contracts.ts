import type { AccountOwner, PendingRow } from "@modules/domain/account-data"

/** The provider identity admitted by a bank-feed receipt. */
export type BankFeedProvider = "casso" | "payos" | "sepay-feed"

/** One movement a payment connection reports: money in, or money out of the account. */
export interface IncomingCredit {
    /** The moved amount in VND, always positive. */
    readonly amount: number
    /** The transfer content. */
    readonly content: string
    /** The provider-prefixed transaction id: the idempotency key. */
    readonly eventId: string
    /** The bank name to show when the connection has no name. */
    readonly fallbackBankName: string
    /** `debit` for money that left the account (a supplier payment); absent for money that came in. */
    readonly direction?: "debit"
    /** The bank account number the movement belongs to, when the provider says. */
    readonly account?: string
    /** Who paid, when the provider says. */
    readonly payer?: string
    /** When the bank booked the movement, ISO text, when the provider says. */
    readonly occurredAt?: string
    /**
     * The BANK's own reference of the movement (the transfer's reference number at the bank), when the provider passes it on: never the
     * provider's row id. With the account number and the amount it names the movement whichever feed reports it.
     */
    readonly bankRef?: string
    /**
     * The provider's own reference of the payment request this movement pays (payOS: the paid link's order code), when the provider names
     * one: a request's paid event is matched by it (owner ruling R111), never by the transfer's words.
     */
    readonly requestRef?: string
}

/** A pending movement of a bank door, held by the caller's transaction lock until its consumption and completion commit together. */
export interface PendingBankMovement {
    /** The movement as its `<provider>.transaction` row holds it. */
    readonly value: Readonly<Record<string, unknown>>
    /** The account the movement belongs to. */
    readonly owner: AccountOwner
    /** The locked row, as its completion needs it. */
    readonly row: PendingRow
}

/** A pending movement, or undefined when it is absent or already complete. */
export type BankMovementLookup = PendingBankMovement | undefined
