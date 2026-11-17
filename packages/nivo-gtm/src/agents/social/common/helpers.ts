/** An instant plus whole hours, as ISO text with the `Z` offset an object datetime field takes. */
export const addHours = (iso: string, hours: number): string => new Date(Date.parse(iso) + hours * 3_600_000).toISOString()

/** A text cut to a length (a card or a field has a limit), with an ellipsis when it was cut. */
export const clip = (text: string, length: number): string => (text.length <= length ? text : `${text.slice(0, length - 1)}…`)

/** The instant of a publish hour `HH:MM` (Ho Chi Minh City, UTC+7) on the day `YYYY-MM-DD`, as ISO with `Z`. */
export const slotInstant = (day: string, hour: string): string => new Date(Date.parse(`${day}T${hour}:00Z`) - 7 * 3_600_000).toISOString()

/** The day `YYYY-MM-DD` that is `days` after the day of an instant, in Ho Chi Minh City time. */
export const dayAfter = (iso: string, days: number): string => new Date(Date.parse(iso) + 7 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10)
