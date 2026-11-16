import {
    SANDBOX_LATE_MAX_SECONDS,
    deliveryChoicesOf,
    deliveryModesOf,
    isDeliveryMode,
    lateSecondsOf,
    modeInputOf,
} from "./sandbox.modes"

/** Two inbound cases of one provider the page has never heard of: one the poll can read back, one it cannot. */
const POLLED = { delivery: null, polled: true }
const PUSHED = { delivery: null, polled: false }
/** A case that is itself a name for a mode (a thin name over `twice`). */
const NAMED = { delivery: "twice", polled: true }

describe("deliveryModesOf", () => {
    it("offers once, twice and late to any case, and withheld only when the poll can bring it back", () => {
        expect(deliveryModesOf(PUSHED)).toEqual(["once", "twice", "late"])
        expect(deliveryModesOf(POLLED)).toEqual(["once", "twice", "withheld", "late"])
    })

    it("offers a case that is itself a name for a mode only that mode, as the case says", () => {
        expect(deliveryModesOf(NAMED)).toEqual(["once"])
    })
})

describe("deliveryChoicesOf", () => {
    it("lists the modes at least one case allows, in the frame's order, and withheld only if a case is polled", () => {
        expect(deliveryChoicesOf([PUSHED])).toEqual(["once", "twice", "late"])
        expect(deliveryChoicesOf([PUSHED, POLLED])).toEqual(["once", "twice", "withheld", "late"])
        expect(deliveryChoicesOf([NAMED])).toEqual(["once"])
        expect(deliveryChoicesOf([])).toEqual([])
    })
})

describe("isDeliveryMode", () => {
    it("knows the frame's four words and nothing else", () => {
        expect(["once", "twice", "withheld", "late"].every(isDeliveryMode)).toBe(true)
        expect(isDeliveryMode("reversed")).toBe(false)
    })
})

describe("lateSecondsOf", () => {
    it("turns an amount and a unit into seconds", () => {
        expect(lateSecondsOf(1, "hours")).toBe(3600)
        expect(lateSecondsOf(49, "hours")).toBe(176400)
        expect(lateSecondsOf(30, "days")).toBe(SANDBOX_LATE_MAX_SECONDS)
    })

    it("refuses what the frame refuses: nothing, a fraction of a second, more than thirty days", () => {
        expect(lateSecondsOf(0, "minutes")).toBeNull()
        expect(lateSecondsOf(Number.NaN, "minutes")).toBeNull()
        expect(lateSecondsOf(0.5, "minutes")).toBe(30)
        expect(lateSecondsOf(0.001, "minutes")).toBeNull()
        expect(lateSecondsOf(31, "days")).toBeNull()
    })
})

describe("modeInputOf", () => {
    it("sends nothing for once, so a case that names its own mode is sent as it is", () => {
        expect(modeInputOf("once", 1, "hours")).toEqual({})
    })

    it("sends the mode for twice and withheld, and the interval only for late", () => {
        expect(modeInputOf("twice", 5, "days")).toEqual({ mode: "twice" })
        expect(modeInputOf("withheld", 5, "days")).toEqual({ mode: "withheld" })
        expect(modeInputOf("late", 2, "hours")).toEqual({ mode: "late", lateBySeconds: 7200 })
    })

    it("sends nothing at all for a late interval the frame would refuse", () => {
        expect(modeInputOf("late", 0, "hours")).toBeNull()
        expect(modeInputOf("late", 99, "days")).toBeNull()
    })
})
