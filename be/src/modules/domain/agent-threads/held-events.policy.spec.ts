import { heldEventsOf } from "./held-events.policy"

describe("heldEventsOf: the events a run's held wakes stand for (ENGINE-FIN (a))", () => {
    it("a stream marker counts its folded events, an `each` wake one, a `latest` wake one whatever it replaced", () => {
        expect(heldEventsOf([{ combine: "stream", count: "3" }])).toBe(3)
        expect(heldEventsOf([{ combine: "each" }, { combine: "each" }])).toBe(2)
        expect(heldEventsOf([{ combine: "latest", count: "4" }])).toBe(1)
        expect(heldEventsOf([{ combine: "stream", count: "2" }, { combine: "each" }, { combine: "latest", count: "5" }])).toBe(4)
    })

    it("a wake that declares no combine and no count is one event; none held is zero", () => {
        expect(heldEventsOf([{}])).toBe(1)
        expect(heldEventsOf([])).toBe(0)
    })
})
