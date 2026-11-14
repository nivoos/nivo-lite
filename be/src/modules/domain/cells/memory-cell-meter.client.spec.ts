import type { CellRef } from "./cells.contracts"
import { MemoryCellMeterClient } from "./memory-cell-meter.client"

const cell: CellRef = { kind: "tool", key: "demo.model.complete", version: 1 }

describe("MemoryCellMeterClient", () => {
    it("a workspace with no pool, or an empty one, is not allowed", async () => {
        const meter = new MemoryCellMeterClient()
        expect(await meter.allows("ws", cell, null)).toBe(false)
        meter.fund("ws", 0)
        expect(await meter.allows("ws", cell, null)).toBe(false)
    })

    it("allows what the pool covers, draws down on a billed booking and keeps a failed try unbilled", async () => {
        const meter = new MemoryCellMeterClient()
        meter.fund("ws", 100)
        expect(await meter.allows("ws", cell, { units: 100 })).toBe(true)
        expect(await meter.allows("ws", cell, { units: 101 })).toBe(false)
        await meter.book("ws", cell, { units: 40 }, true)
        await meter.book("ws", cell, { units: 0 }, false)
        expect(meter.balanceOf("ws")).toBe(60)
        expect(meter.bookings()).toEqual([
            { workspaceId: "ws", cell, usage: { units: 40 }, billed: true },
            { workspaceId: "ws", cell, usage: { units: 0 }, billed: false },
        ])
    })
})
