import { mock } from "@starci/jest-preset"
import type { CustomerLine } from "./customer-line-store.port"
import { MemoryStreamCursorStore } from "@tests/fixtures/builders/customer-routes-stores.builder"
import { prefixPatternOf } from "./stream-cursor-store.typeorm"
import { isStepCall, newestHeardSeqOf, seqAfter, stepCallPrefixOf } from "./stream-cursor.policy"
import { StreamCursorService } from "./stream-cursor.service"

// THE STREAM CURSOR (rule QB-P5 C-4, owner defect O-R6-2): a step's read of the route's lines is PENDING until that step ENDS; then the
// newest person line it read is what runs consumed. The memory store below keeps the table's rule (one pending read per route; the same
// call keeps its newest; the end of a step folds the reads of its calls into the cursor, the greater of the two).

const lineOf = (seq: string, direction: CustomerLine["direction"]): CustomerLine =>
    mock<CustomerLine>({ seq, direction })

describe("stream cursor policy", () => {
    it("positions compare as whole numbers given as text", () => {
        expect([seqAfter("10", "9"), seqAfter("9", "10"), seqAfter("12", "12"), seqAfter("007", "6")]).toEqual([true, false, false, true])
    })

    it("a read's position is its newest PERSON line; the shop's lines do not count; none read = none", () => {
        expect(newestHeardSeqOf([lineOf("9", "from_person"), lineOf("12", "to_person"), lineOf("10", "from_person")])).toBe("10")
        expect(newestHeardSeqOf([lineOf("12", "to_person")])).toBeNull()
    })

    it("a step's calls are the keys `<run>:<step>:...`; step `a` never folds step `ab`'s read; a LIKE pattern escapes its wildcards", () => {
        expect(stepCallPrefixOf("run-1", "hear")).toBe("run-1:hear:")
        expect(isStepCall("run-1:hear:3f2a", "run-1", "hear")).toBe(true)
        expect(isStepCall("run-1:hearing:3f2a", "run-1", "hear")).toBe(false)
        expect(prefixPatternOf("run_1:a%b:")).toBe("run\\_1:a\\%b:%")
    })
})

describe("StreamCursorService", () => {
    it("a read is pending until its step ENDS: then the cursor is the newest person line it read", async () => {
        const store = new MemoryStreamCursorStore()
        const cursor = new StreamCursorService(store)
        await cursor.read("ws", "route-1", "run-1:hear:d1", [lineOf("5", "from_person"), lineOf("6", "from_person")])

        expect(await cursor.cursorOf("ws", "route-1")).toBeNull()
        expect(await cursor.stepEnded("ws", "run-1", "hear")).toBe(1)
        expect(await cursor.cursorOf("ws", "route-1")).toBe("6")
    })

    it("a step that stops (never ends) consumes nothing; another step's end does not fold it", async () => {
        const store = new MemoryStreamCursorStore()
        const cursor = new StreamCursorService(store)
        await cursor.read("ws", "route-1", "run-1:consult:d1", [lineOf("7", "from_person")])

        expect(await cursor.stepEnded("ws", "run-1", "hear")).toBe(0)
        expect(await cursor.cursorOf("ws", "route-1")).toBeNull()
    })

    it("a later read by another step replaces the pending one; the cursor never moves back", async () => {
        const store = new MemoryStreamCursorStore()
        const cursor = new StreamCursorService(store)
        await cursor.read("ws", "route-1", "run-1:a:d", [lineOf("8", "from_person")])
        await cursor.stepEnded("ws", "run-1", "a")
        await cursor.read("ws", "route-1", "run-2:b:d", [lineOf("4", "from_person")])
        await cursor.stepEnded("ws", "run-2", "b")

        expect(await cursor.cursorOf("ws", "route-1")).toBe("8")
    })

    it("a read of no person line notes nothing", async () => {
        const store = new MemoryStreamCursorStore()
        const cursor = new StreamCursorService(store)
        await cursor.read("ws", "route-1", "run-1:a:d", [lineOf("3", "to_person")])
        expect(store.rows.size).toBe(0)
    })
})
