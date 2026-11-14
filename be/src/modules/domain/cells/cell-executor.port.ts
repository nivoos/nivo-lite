import type { ExecuteRequest, ExecuteResult } from "./cells.contracts"

/** The one "eval run" of a cell (CELLS-PLAN 1.5). Implemented by slice S4 (`CellExecutorService`); S5 calls it. S5 develops against `ScriptedCellExecutor`. */
export interface CellExecutor {
    /** Validates in, gates the meter, writes the intent, runs, validates out, classifies and books; always answers an outcome and its verdict. */
    execute(request: ExecuteRequest): Promise<ExecuteResult>
}
