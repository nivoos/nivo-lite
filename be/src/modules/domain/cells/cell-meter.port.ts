import type { CellRef, UsageFigures } from "./cells.contracts"

/** The credit meter of a metered cell (CELLS-PLAN 6). Phase 0 has the in-memory adapter (S4); the real one comes at migration step M2. */
export interface CellMeter {
    /** False when the workspace credit pool cannot cover the estimate: nothing runs and the verdict is `stop / credits_exhausted`. */
    allows(workspaceId: string, cell: CellRef, estimate: UsageFigures | null): Promise<boolean>
    /** Books the usage; a failed try is booked with `billed` false (never billed). */
    book(workspaceId: string, cell: CellRef, usage: UsageFigures, billed: boolean): Promise<void>
}
