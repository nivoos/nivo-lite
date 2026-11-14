import { isRecord } from "@modules/platform/primitives"

/** What a `zalo_oa.event` row the POLL kept says of the customer message it carries, as the admission needs it. */
export interface PolledMessageOfRow {
    /** Zalo's id of the message (`msg_id`). */
    readonly messageId: string
    /** The name the owner sees the message under: the name the OA's listing shows, else the customer's Zalo id. */
    readonly sender: string
    /** What the customer wrote. */
    readonly text: string
    /** When the customer wrote it, in epoch milliseconds. */
    readonly sentAt: number
    /** The body the row keeps, untouched. */
    readonly raw: object
}

/** A text field of a record, or an empty text. */
const textOf = (source: unknown, key: string): string => {
    const value: unknown = isRecord(source) ? source[key] : undefined
    return typeof value === "string" || typeof value === "number" ? String(value) : ""
}

/**
 * The message a row the poll kept carries, or null for a row the webhook (or an import) kept, and for a body that names no message id or no
 * time: such a row has no age to judge and takes the road of a fresh message. Pure: it reads the row's members only.
 */
export const polledMessageOf = (value: object): PolledMessageOfRow | null => {
    const row: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value))
    const raw = row.raw
    if (row.source !== "poll" || !isRecord(raw)) return null
    const messageId = textOf(raw.message, "msg_id")
    const sentAt = Number(textOf(raw, "timestamp"))
    if (messageId === "" || !Number.isFinite(sentAt) || sentAt <= 0) return null
    const userId = textOf(raw.sender, "id")
    const shown = textOf(raw.sender, "display_name").trim()
    return { messageId, sender: shown === "" ? userId : shown, text: textOf(raw.message, "text"), sentAt, raw }
}
