import { Test } from "@nestjs/testing"
import { calendarDayOf, relativeDayOf, resolvedDayOf, type CalendarDay } from "./extraction-calendar.policy"
import { TestWorldError, TestWorldErrorCode } from "@tests/world/test-world.error"

const SUBJECT = Symbol("extraction-calendar.policy")

/** The calendar's own functions, provided through a testing module the way Nest builds a subject. */
const build = async (): Promise<typeof import("./extraction-calendar.policy")> => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { relativeDayOf, resolvedDayOf } }],
    }).compile()
    return moduleRef.get<typeof import("./extraction-calendar.policy")>(SUBJECT)
}

/** A calendar day from its text, for the arithmetic cases. */
const day = (text: string): CalendarDay => {
    const parsed = calendarDayOf(text)
    if (parsed === null)
        throw new TestWorldError({ code: TestWorldErrorCode.RowMissing, params: { what: `not a day: ${text}` } })
    return parsed
}

/** The day a resolved day writes, or null. */
const textOf = (resolved: CalendarDay | null): string | null =>
    resolved === null
        ? null
        : `${String(resolved.year)}-${String(resolved.month).padStart(2, "0")}-${String(resolved.day).padStart(2, "0")}`

describe("extraction-calendar.policy: a day relative to the document's own date is read by format and computed by calendar arithmetic", () => {
    let subject: typeof import("./extraction-calendar.policy")

    beforeEach(async () => {
        subject = await build()
    })

    it("reads the relative forms by format only", () => {
        expect(subject.relativeDayOf("D+14")).toEqual({ kind: "days", days: 14 })
        expect(subject.relativeDayOf("d - 1")).toEqual({ kind: "days", days: -1 })
        expect(subject.relativeDayOf("D>mon")).toEqual({ kind: "weekday", weekday: 1 })
        expect(subject.relativeDayOf("M+1:last")).toEqual({ kind: "month", months: 1, edge: "last" })
        expect(subject.relativeDayOf("M+0:first")).toEqual({ kind: "month", months: 0, edge: "first" })
        expect(subject.relativeDayOf("M+40:last")).toBeNull()
        expect(subject.relativeDayOf("D+9999")).toBeNull()
        expect(subject.relativeDayOf("D>xyz")).toBeNull()
        expect(subject.relativeDayOf("next monday")).toBeNull()
    })

    it.each([
        ["2026-01-31", "M+1:last", "2026-02-28"],
        ["2028-01-15", "M+1:last", "2028-02-29"],
        ["2026-12-20", "M+1:last", "2027-01-31"],
        ["2026-12-20", "M+1:first", "2027-01-01"],
        ["2026-11-12", "M+0:last", "2026-11-30"],
        ["2026-02-20", "D+13", "2026-03-05"],
        ["2028-02-28", "D+1", "2028-02-29"],
        ["2027-02-28", "D+1", "2027-03-01"],
        ["2026-12-31", "D+1", "2027-01-01"],
        ["2026-03-01", "D-1", "2026-02-28"],
        ["2026-03-31", "D+0", "2026-03-31"],
        // 2026-11-12 is a Thursday: the first Monday after it, and the next Thursday (never the day itself).
        ["2026-11-12", "D>mon", "2026-11-16"],
        ["2026-11-12", "D>thu", "2026-11-19"],
        ["2026-11-12", "D>fri", "2026-11-13"],
    ])("from the document's date %s, %s is %s", (reference, form, expected) => {
        const relative = relativeDayOf(form)
        expect(relative).not.toBeNull()
        if (relative === null) return
        expect(textOf(subject.resolvedDayOf(day(reference), relative))).toBe(expected)
    })
})
