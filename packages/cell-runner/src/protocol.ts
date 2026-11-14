/*
 * The wire protocol of the runner process: JSON lines on stdin and stdout (CELLS-PLAN 4.3). These are the runner's OWN copies of the types of
 * `be/src/modules/domain/cells/cells.contracts.ts` (the package imports nothing from `be`); the client spec asserts that the two stay assignable.
 */

/** Any JSON value. */
export type JsonValue =
    string | number | boolean | null | ReadonlyArray<JsonValue> | { readonly [member: string]: JsonValue }

/** What a run is given in place of a clock and a random source. */
export interface RunnerFacts {
    readonly at: string
    readonly day: string
    readonly randomSeed: string
    readonly item: JsonValue
    readonly queue: ReadonlyArray<{ readonly [member: string]: JsonValue }>
    readonly waiting: number
    readonly workspace: { readonly [member: string]: JsonValue }
}

/** The limits one run is held to. */
export interface RunnerLimits {
    readonly memoryBytes: number
    readonly stackBytes: number
    readonly cpuMs: number
    readonly wallMs: number
    readonly outputBytes: number
    readonly maxCalls: number
}

/** The messages the api sends to the runner. */
export type RunnerInbound =
    | {
          readonly type: "run"
          readonly id: string
          readonly entry: "run" | "translate"
          readonly source: string
          readonly sha256: string
          readonly input: JsonValue
          readonly facts: RunnerFacts
          readonly limits: RunnerLimits
          /** What the guest may reach: today `tool` (tool and say). The next phase adds more names, offered by the client from the cell's kind. */
          readonly capabilities: ReadonlyArray<string>
      }
    | { readonly type: "answer"; readonly id: string; readonly call: number; readonly answer: JsonValue }
    | { readonly type: "check"; readonly id: string; readonly source: string }

/** The messages the runner sends back. */
export type RunnerOutbound =
    | {
          readonly type: "call"
          readonly id: string
          readonly call: number
          readonly tool: string
          readonly args: JsonValue
      }
    | { readonly type: "say"; readonly id: string; readonly call: number; readonly request: JsonValue }
    | { readonly type: "done"; readonly id: string; readonly output: JsonValue }
    | { readonly type: "ended"; readonly id: string; readonly reason: "cannot"; readonly why: string }
    | {
          readonly type: "failed"
          readonly id: string
          readonly why: "limits" | "thrown" | "syntax" | "output"
          readonly detail: string
      }
    | { readonly type: "checked"; readonly id: string; readonly problems: ReadonlyArray<string> }

/** The terminal answers of a run. */
export type RunnerRunResult = Extract<RunnerOutbound, { readonly type: "done" | "ended" | "failed" }>
