import { addDays, dayStartMs } from "@modules/domain/workspace-settings"

/** The calendar of the truths reading: days, days relative to the document's own date, and the periods computed from them. */

/** A day given relative to the document's own date, as rule 4b writes it (a structured field, read by format only). */
export type RelativeDay =
    /** `D+N` / `D-N`: N days after (before) the document's date. */
    | { readonly kind: "days"; readonly days: number }
    /** `D>mon` ... `D>sun`: the first such weekday after the document's date (0 = Sunday ... 6 = Saturday). */
    | { readonly kind: "weekday"; readonly weekday: number }
    /** `M+K:first` / `M+K:last`: the first or last day of the K-th month after the document's month. */
    | { readonly kind: "month"; readonly months: number; readonly edge: "first" | "last" }

/** The relative sides of a line's period, and the two fields as written. */
export interface RelativePeriod {
    /** The first day, when given relative; null when given as a day or not at all. */
    readonly from: RelativeDay | null
    /** The last day (included), when given relative; null when given as a day or not at all. */
    readonly to: RelativeDay | null
    /** `from|to` as the line wrote them, for the period's note. */
    readonly written: string
}

/** One calendar date: year, month and day. */
export interface CalendarDay {
    /** The year, 2000 to 2100. */
    readonly year: number
    /** The month, 1 to 12. */
    readonly month: number
    /** The day of the month, 1 to its last day. */
    readonly day: number
}

/** One day in milliseconds. */
const DAY_MS = 86_400_000

/** The number of days of a month (1 to 12) of a year: the calendar's, leap years included. */
const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** A calendar day as numbers, when the calendar has it and it lies between 2000 and 2100, else null. */
const calendarDayFrom = (year: number, month: number, day: number): CalendarDay | null =>
    Number.isInteger(year) &&
    year >= 2000 &&
    year <= 2100 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
        ? { year, month, day }
        : null

/**
 * The calendar day a field writes, STRICTLY `YYYY-MM-DD` with nothing around it, between 2000 and 2100 and a day the calendar has
 * ("2026-02-30" is none: `Date.parse` would roll it into March, a wrong day), else null. Format only.
 */
export const calendarDayOf = (value: string): CalendarDay | null => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value.trim())
    if (match === null) return null
    return calendarDayFrom(Number(match[1]), Number(match[2]), Number(match[3]))
}

/** A calendar day written `YYYY-MM-DD`. */
export const dayTextOf = (day: CalendarDay): string =>
    `${String(day.year)}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`

/** A calendar day from a UTC instant at midnight (the arithmetic below works in UTC days, which have no clock shifts). */
const dayFromUtc = (instant: number): CalendarDay | null => {
    const date = new Date(instant)
    return calendarDayFrom(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** The weekdays a relative day may name, in `getUTCDay` order (the format of a structured field, not words of a text). */
const WEEKDAYS: ReadonlyArray<string> = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

/** The most days a relative day may reach from the document's date (a bound of the format). */
const RELATIVE_DAYS_MAX = 3_660

/** The most months a relative day may reach from the document's month (a bound of the format). */
const RELATIVE_MONTHS_MAX = 36

/**
 * The relative day a field writes in a form of rule 4b (`D+14`, `D-1`, `D>mon`, `M+1:last`), or null when it is none of them. It reads
 * the FORMAT of a structured field the model filled; the model alone reads what the document's words mean.
 */
export const relativeDayOf = (value: string): RelativeDay | null => {
    const text = value.trim().toLowerCase()
    const days = /^d\s*([+-])\s*(\d{1,4})$/u.exec(text)
    if (days !== null) {
        const count = Number(days[2])
        return count > RELATIVE_DAYS_MAX ? null : { kind: "days", days: days[1] === "-" ? -count : count }
    }
    const weekday = /^d\s*>\s*([a-z]{3})$/u.exec(text)
    if (weekday !== null) {
        const at = WEEKDAYS.indexOf(weekday[1] ?? "")
        return at < 0 ? null : { kind: "weekday", weekday: at }
    }
    const month = /^m\s*\+\s*(\d{1,2})\s*:\s*(first|last)$/u.exec(text)
    if (month === null || Number(month[1]) > RELATIVE_MONTHS_MAX) return null
    return { kind: "month", months: Number(month[1]), edge: month[2] === "first" ? "first" : "last" }
}

/**
 * The calendar day a relative day stands for, counted from the document's own date (calendar arithmetic only): `D+N` adds N days;
 * `D>wd` is the first such weekday AFTER the date (never the date itself); `M+K:first` / `M+K:last` is the first / last day of the
 * K-th month after the date's month (month lengths and leap years from the calendar). Null when it falls outside 2000-2100.
 */
export const resolvedDayOf = (reference: CalendarDay, relative: RelativeDay): CalendarDay | null => {
    const base = Date.UTC(reference.year, reference.month - 1, reference.day)
    if (relative.kind === "days") return dayFromUtc(base + relative.days * DAY_MS)
    if (relative.kind === "weekday") {
        const ahead = (relative.weekday - new Date(base).getUTCDay() + 7) % 7
        return dayFromUtc(base + (ahead === 0 ? 7 : ahead) * DAY_MS)
    }
    const monthIndex = reference.month - 1 + relative.months
    return dayFromUtc(
        relative.edge === "first"
            ? Date.UTC(reference.year, monthIndex, 1)
            : Date.UTC(reference.year, monthIndex + 1, 0),
    )
}

/** The start of a calendar day as an instant: its midnight in the workspace's time zone (the shop's calendar). */
const dayStartOf = (day: CalendarDay, timeZone: string): number => dayStartMs(dayTextOf(day), timeZone)

/** The start of a truth from its stated FIRST day, ISO 8601 (midnight in the workspace's time zone). */
export const startOf = (day: CalendarDay, timeZone: string): string => new Date(dayStartOf(day, timeZone)).toISOString()

/** The end of a truth from its stated LAST day: the start of the next day (in the workspace's time zone), so the stated day is included. */
export const endOf = (day: CalendarDay, timeZone: string): string =>
    new Date(dayStartMs(addDays(dayTextOf(day), 1), timeZone)).toISOString()

/** A period: its first instant and its end (ISO 8601), each null when open. */
export interface Period {
    /** The first instant of the period, or null when it has no start. */
    readonly validFrom: string | null
    /** The end of the period (the start of the day after its last day), or null when it has no end. */
    readonly validTo: string | null
}

/** A period whose sides may be given relative to the document's own date. */
export interface PeriodSides extends Period {
    /** The relative sides of the period, when it was written relative to the document's date. */
    readonly relative?: RelativePeriod
}

/**
 * The period of a truth whose sides were given relative to the document's own date (rule 4b), computed from the date the DOCUMENT
 * states (`reference`: read by the model, checked against the line that states it; never the upload date): each relative side becomes
 * its calendar day, the last day included (`validTo` is the start of the next day, as for a written day). Null when a side falls
 * outside the calendar's bounds or the computed period ends before it starts: the truth is then filed without a period, flagged
 * `period_unclear` (`datedFactOf`), never with a guessed day.
 */
export const resolvedPeriodOf = (fact: PeriodSides, reference: CalendarDay, timeZone: string): Period | null => {
    const relative = fact.relative
    if (relative === undefined) return { validFrom: fact.validFrom, validTo: fact.validTo }
    const from = relative.from === null ? null : resolvedDayOf(reference, relative.from)
    const to = relative.to === null ? null : resolvedDayOf(reference, relative.to)
    if ((relative.from !== null && from === null) || (relative.to !== null && to === null)) return null
    const validFrom = from === null ? fact.validFrom : startOf(from, timeZone)
    const validTo = to === null ? fact.validTo : endOf(to, timeZone)
    if (validFrom !== null && validTo !== null && Date.parse(validTo) <= Date.parse(validFrom)) return null
    return { validFrom, validTo }
}
