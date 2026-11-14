import { DEFAULT_TRIGGER_COMBINE, TRIGGER_COMBINE_MODES, isTriggerCombine } from "./trigger-event"
import type { TriggerScope } from "./trigger-event"

// Rule Q-4 (QB-P5): how the pending events of one subject combine is DECLARED by the trigger, in three words only; absent = `each`.

describe("trigger combine modes", () => {
    it("are exactly each, latest and stream, and a declaration that names none combines each by each", () => {
        expect([...TRIGGER_COMBINE_MODES]).toEqual(["each", "latest", "stream"])
        expect(DEFAULT_TRIGGER_COMBINE).toBe("each")
    })

    it("a text names a mode only when it is one of the three, exactly", () => {
        expect(TRIGGER_COMBINE_MODES.every((mode) => isTriggerCombine(mode))).toBe(true)
        expect(["", "Stream", "merge", null, undefined, 1].some((value) => isTriggerCombine(value))).toBe(false)
    })

    it("the scope of a stream marker keeps the one-event shape and adds since and count", () => {
        const marker: TriggerScope = { eventId: "e-1", data: { text: "oldest" }, since: "2026-11-14T10:00:00.000Z", count: 4 }
        expect(marker.data).toEqual({ text: "oldest" })
        expect([marker.since, marker.count]).toEqual(["2026-11-14T10:00:00.000Z", 4])
    })
})
