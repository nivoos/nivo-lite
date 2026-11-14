import type { SepayTransaction } from "@modules/integrations/sepay"
import { bankTransactionValueOf } from "@modules/domain/bank-feed-inbox"
import type { BankTransaction, PolledRow } from "@modules/domain/provider-registry"

/** The bank name shown when SePay lists none. */
const FALLBACK_BANK = "SePay"

/**
 * Maps one listed SePay transaction to the `sepay.transaction` row the webhook would have kept for it: the same builder, so the event id
 * (`sepay:<id>`) is the webhook's key and the movement is one row whichever way brought it first. Money in is a credit, money out a debit; a
 * row that moved no money is nothing. The bank's facts are the row's own: its reference, and its account number, falling back to the
 * connection's account only when the row names none.
 */
export const sepayPolledRow = (row: SepayTransaction, account: string): PolledRow | undefined => {
    const credit = row.amountIn > 0
    const amount = credit ? row.amountIn : row.amountOut
    if (amount <= 0) return undefined
    return {
        value: bankTransactionValueOf(
            {
                amount,
                content: row.content !== "" ? row.content : (row.code ?? ""),
                eventId: `sepay:${row.id}`,
                fallbackBankName: row.bank ?? FALLBACK_BANK,
                ...(credit ? {} : { direction: "debit" as const }),
                account: row.account ?? account,
                occurredAt: row.occurredAt.toISOString(),
                ...(row.reference === undefined ? {} : { bankRef: row.reference }),
            },
            "poll",
        ),
        at: row.occurredAt,
    }
}

/** One listed SePay transaction in the bank-feed shape nodes and agents read; a row that moved no money is nothing. */
export const sepayBankTransaction = (row: SepayTransaction): BankTransaction | undefined => {
    const credit = row.amountIn > 0
    const amountVnd = credit ? row.amountIn : row.amountOut
    if (amountVnd <= 0) return undefined
    return {
        id: `sepay:${row.id}`,
        direction: credit ? "credit" : "debit",
        amountVnd,
        content: row.content !== "" ? row.content : (row.code ?? ""),
        occurredAt: row.occurredAt.toISOString(),
        bankName: row.bank ?? FALLBACK_BANK,
    }
}
