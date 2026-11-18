/** An instant plus whole hours, as ISO text with the `Z` offset an object datetime field takes. */
export const addHours = (iso: string, hours: number): string =>
    new Date(Date.parse(iso) + hours * 3_600_000).toISOString()

/** The day of an instant without dashes (`2026-11-18T08:00:00Z` is `20261118`), the stem of a content code. */
export const compactDay = (iso: string): string => iso.slice(0, 10).replaceAll("-", "")

/** A text cut to a length (a card or a field has a limit), with an ellipsis when it was cut. */
export const clip = (text: string, length: number): string =>
    text.length <= length ? text : `${text.slice(0, length - 1)}…`

/** The text of a loose value an object field or a model answer carries: a string as it is, a number or flag as its text, anything else (missing, null, a list, a record) as empty. */
export const textOf = (value: unknown): string => {
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return ""
}
