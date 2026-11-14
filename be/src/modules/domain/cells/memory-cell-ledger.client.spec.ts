import type { CellOutcome } from "./cells.contracts"
import { MemoryCellLedgerClient } from "./memory-cell-ledger.client"

const ok: CellOutcome = { kind: "ok", output: 1 }

describe("MemoryCellLedgerClient", () => {
    it("acts once per key and answers the kept outcome after", async () => {
        const ledger = new MemoryCellLedgerClient()
        const act = jest.fn(() => Promise.resolve(ok))
        expect(await ledger.once("k", act)).toEqual({ replayed: false, outcome: ok })
        expect(await ledger.once("k", act)).toEqual({ replayed: true, outcome: ok })
        expect(act).toHaveBeenCalledTimes(1)
    })

    it("a throw releases the key unless it carries outcomeUnknown, which keeps it open and answers unknown", async () => {
        const ledger = new MemoryCellLedgerClient()
        await expect(ledger.once("a", () => Promise.reject(new Error("x")))).rejects.toThrow("x")
        expect(await ledger.once("a", () => Promise.resolve(ok))).toEqual({ replayed: false, outcome: ok })
        await expect(ledger.once("b", () => Promise.reject(Object.assign(new Error("lost"), { outcomeUnknown: 1 })))).rejects.toThrow("lost")
        const act = jest.fn(() => Promise.resolve(ok))
        expect(await ledger.once("b", act)).toEqual({ replayed: true, outcome: { kind: "unknown", key: "b" } })
        expect(act).not.toHaveBeenCalled()
        await expect(ledger.once("c", () => Promise.reject(Object.assign(new Error("w"), { outcomeUnknown: 0 })))).rejects.toThrow("w")
        expect((await ledger.once("c", act)).replayed).toBe(false)
    })
})
