import type { JsonValue, RunnerRunRequest, RunnerRunResult, ToolAnswer } from "./cells.contracts"

/** What a running source reaches out through, given by the executor (S4) per execution. The runner never sees anything else. */
export interface RunnerDoor {
    /** One tool call of the source; the door answers from its record on a re-run. */
    call(call: number, tool: string, args: JsonValue): Promise<ToolAnswer>
    /** A `ctx.say` request: the door turns it into text. */
    say(call: number, request: JsonValue): Promise<JsonValue>
}

/**
 * The isolated runner as the api sees it (CELLS-PLAN 4). Implemented by slice S3 (`CellRunnerClient` over `packages/cell-runner`); S4 calls it.
 * S4 develops against `ScriptedCellRunner` until it lands.
 */
export interface CellRunner {
    /** Runs a source with the limits; a tool call goes to the door; an undeclared tool is the client refusal `CELLS_TOOL_UNDECLARED`. */
    run(request: RunnerRunRequest, door: RunnerDoor): Promise<RunnerRunResult>
    /** Parses a source without running it and answers the problems found (empty: it is a valid script). */
    check(source: string): Promise<ReadonlyArray<string>>
}
