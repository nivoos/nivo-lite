/** What the payer's browser was told: sent back after the payment page, or after cancelling on it. */
export type PayDoneState = "returned" | "cancelled"

/** A query as Next hands it over: each value one text, a list when repeated, or absent. */
export type PayDoneQuery = Readonly<Record<string, string | ReadonlyArray<string> | undefined>>

/** One own member of the query (never one inherited through the prototype). */
const ownValue = (query: PayDoneQuery, name: string): string | ReadonlyArray<string> | undefined =>
    Object.prototype.hasOwnProperty.call(query, name) ? query[name] : undefined

/**
 * The state of the page from the query the payment provider appended (`cancel`, `status`).
 * The query is untrusted input read as exact words, never rendered: only the exact word `true` for `cancel`, or the exact `CANCELLED` for
 * `status`, says "cancelled"; anything else (absent, repeated, other words, hostile text) says "returned", the neutral sentence that
 * claims no success. The shop learns the outcome from the provider's own event, never from this page.
 */
export const payDoneStateOf = (query: PayDoneQuery): PayDoneState => {
    const cancel = ownValue(query, "cancel")
    const status = ownValue(query, "status")
    return cancel === "true" || status === "CANCELLED" ? "cancelled" : "returned"
}
