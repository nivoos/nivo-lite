import type { ExecuteScope, JsonValue, ToolAnswer, ToolCallKey } from "./cells.contracts"

/**
 * The engine tool door a cell reaches tools through: rights, `auto | ask`, account choice, one world per run (CELLS-PLAN 1.5, step 4).
 * Phase 0 has only a scripted double (`ScriptedCellToolDoor`); the V1 adapter comes at migration step M5.
 */
export interface CellToolDoor {
    /** Calls one tool for the scope; a refusal is an answer, not a throw. `call.key` is the intent key of this call, for a vendor replay key. */
    call(scope: ExecuteScope, tool: string, args: JsonValue, call: ToolCallKey): Promise<ToolAnswer>
}
