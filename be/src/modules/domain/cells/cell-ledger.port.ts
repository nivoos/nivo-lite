import type { CellOutcome } from "./cells.contracts"

/**
 * The intent ledger of a write (CELLS-PLAN 1.5, step 3). Phase 0 has the in-memory adapter (S4); the V1 adapter comes at migration step M5.
 * S4 and S5 may use `MemoryCellLedger` of the kit doubles meanwhile.
 */
export interface CellLedger {
    /**
     * Runs `act` once per key: a key already settled answers its kept outcome without acting (`replayed`); a key whose act began and
     * never settled answers `unknown` without acting; a throw releases the key unless it carries `outcomeUnknown`.
     */
    once(key: string, act: () => Promise<CellOutcome>): Promise<{ readonly replayed: boolean; readonly outcome: CellOutcome }>
}
