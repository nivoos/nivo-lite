/** An instant plus whole hours, as ISO text with the `Z` offset an object datetime field takes. */
export const addHours = (iso: string, hours: number): string => new Date(Date.parse(iso) + hours * 3_600_000).toISOString()

/** The day of an instant without dashes (`2026-11-18T08:00:00Z` is `20261118`), the stem of a content code. */
export const compactDay = (iso: string): string => iso.slice(0, 10).replace(/-/gu, "")

/** A text cut to a length (a card or a field has a limit), with an ellipsis when it was cut. */
export const clip = (text: string, length: number): string => (text.length <= length ? text : `${text.slice(0, length - 1)}…`)
