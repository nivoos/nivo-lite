import { isLatestWake, latestReplacingOf, settledNotBeforeOf, streamCoalescingOf, streamCountOf, type UnrunStreamWake } from "./agent-wake-coalesce.policy"

// RULE Q-4 `stream` (QB-P5 C-2), the pure decision: the un-run wakes of one stream set are ONE marker, the OLDEST (R74 item 6: it keeps the
// settle anchor, the order position and the hand-back key); the others close behind it and are counted on it.

const at = (second: number): Date => new Date(Date.UTC(2026, 10, 14, 10, 0, second))
const wake = (id: string, second: number, context: UnrunStreamWake["context"] = {}): UnrunStreamWake => ({
    id,
    createdAt: at(second),
    context: { combine: "stream", eventId: `e-${id}`, ...context },
})

describe("streamCoalescingOf", () => {
    it("a set of one (or none) folds nothing", () => {
        expect(streamCoalescingOf([])).toBeNull()
        expect(streamCoalescingOf([wake("a", 0)])).toBeNull()
    })

    it("4 lines: the OLDEST stays with count 4 and the newest event; the 3 others close behind it, oldest first, whatever the read order", () => {
        const folded = streamCoalescingOf([wake("c", 2), wake("a", 0), wake("d", 3), wake("b", 1)])
        expect(folded).toEqual({
            markerId: "a",
            context: { combine: "stream", eventId: "e-a", count: "4", latestEventId: "e-d" },
            closed: ["b", "c", "d"],
        })
    })

    it("a marker that already stands for 3 events, plus a new one: count 4, its own event kept (the data a run reads)", () => {
        const folded = streamCoalescingOf([wake("m", 0, { count: "3", latestEventId: "e-x" }), wake("n", 9)])
        expect(folded?.markerId).toBe("m")
        expect(folded?.context).toMatchObject({ eventId: "e-m", count: "4", latestEventId: "e-n" })
    })

    it("a NEWER marker found by a delivery that raced: the oldest still wins and the newer marker's count is carried over", () => {
        const folded = streamCoalescingOf([wake("late", 5, { count: "2", latestEventId: "e-late2" }), wake("early", 1)])
        expect(folded).toMatchObject({ markerId: "early", closed: ["late"], context: { count: "3", latestEventId: "e-late2" } })
    })

    it("two wakes written in the same instant are ordered by id", () => {
        expect(streamCoalescingOf([wake("b", 0), wake("a", 0)])?.markerId).toBe("a")
    })

    it("a count that is no positive whole number counts as the wake itself", () => {
        expect([streamCountOf({}), streamCountOf({ count: "0" }), streamCountOf({ count: "x" }), streamCountOf({ count: "5" })]).toEqual([1, 1, 1, 5])
    })
})

describe("settledNotBeforeOf: a pending marker keeps its settle window sliding, capped", () => {
    const marker = { createdAt: at(0), burstWindowMs: 6000, burstMaxMs: 20_000 }

    it("a new event moves the begin to now + the window (less the begin's half-second margin)", () => {
        expect(settledNotBeforeOf(marker, at(3))?.toISOString()).toBe(new Date(at(3).getTime() + 5500).toISOString())
    })

    it("never later than the marker's own time + the longest wait", () => {
        expect(settledNotBeforeOf(marker, at(18))?.toISOString()).toBe(at(20).toISOString())
    })

    it("a marker that settles not at all keeps its begin", () => {
        expect(settledNotBeforeOf({ ...marker, burstWindowMs: null }, at(3))).toBeNull()
    })
})

// RULE Q-4 `latest` (QB-LATEST, QUEUE-DESIGN C.3), the pure decision: the wake JUST WRITTEN (named by the door) replaces every other un-run
// wake of its set; it keeps its own event and counts the ones it replaced.
describe("latestReplacingOf", () => {
    const latest = (id: string, second: number, context: UnrunStreamWake["context"] = {}): UnrunStreamWake => ({
        id,
        createdAt: at(second),
        context: { combine: "latest", eventId: `e-${id}`, ...context },
    })

    it("3 events: the newest stays with count 3 and its OWN event; the 2 older close behind it, oldest first, whatever the read order", () => {
        expect(latestReplacingOf([latest("b", 1), latest("c", 2), latest("a", 0)], "c")).toEqual({
            keptId: "c",
            context: { combine: "latest", eventId: "e-c", count: "3" },
            closed: ["a", "b"],
        })
    })

    it("the newest is the one the door names, never guessed from times (wakes of one delivery share an instant)", () => {
        const folded = latestReplacingOf([latest("z", 0), latest("a", 0)], "a")
        expect(folded?.keptId).toBe("a")
        expect(folded?.closed).toEqual(["z"])
    })

    it("an older wake that already stood for 2 (it replaced one before): the newest stands for 3", () => {
        expect(latestReplacingOf([latest("old", 0, { count: "2" }), latest("new", 5)], "new")?.context.count).toBe("3")
    })

    it("a set of one, or a newest that is no longer in the set (begun / closed meanwhile), decides nothing", () => {
        expect(latestReplacingOf([latest("a", 0)], "a")).toBeNull()
        expect(latestReplacingOf([latest("a", 0), latest("b", 1)], "gone")).toBeNull()
        expect(latestReplacingOf([], "a")).toBeNull()
    })

    it("only a wake of the `latest` mode is one", () => {
        expect(isLatestWake({ combine: "latest" })).toBe(true)
        expect(isLatestWake({ combine: "stream" })).toBe(false)
        expect(isLatestWake({})).toBe(false)
    })
})
