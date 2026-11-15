import type { CellsErrorCode } from "./errors/cells.error"

/*
 * Slice 0 contracts of the cells capability (CELLS-PLAN 9.2). Nothing here has behaviour. An addition after slice 0 is requested from
 * the coordinator in CELLS-NOTES.md; no slice edits this file on its own.
 */

/** Any JSON value. Cells stand alone, so this is their own copy of the shape (the isolation gate forbids the agent-sdk one). */
export type JsonValue =
    string | number | boolean | null | ReadonlyArray<JsonValue> | { readonly [member: string]: JsonValue }

/** A JSON object. */
export type JsonObject = { readonly [member: string]: JsonValue }

/** The closed list of cell kinds (CELLS-PLAN 1.3). */
export type CellKind =
    | "operation"
    | "tool"
    | "node"
    | "trigger"
    | "provider"
    | "core.if"
    | "core.loop"
    | "core.wait"
    | "core.hand-back"
    | "core.call-workflow"
    | "core.outcome"
    | "core.set"

/** Where a row stands: only `approved` rows run; `retired` is the one change an approved row may take. */
export type ReviewState = "draft" | "approved" | "retired"

/** A JSON Schema 2020-12 document. */
export type JsonSchema = JsonObject

/** A short text in both supported languages. */
export interface LocalizedText {
    readonly vi: string
    readonly en: string
}

/** The exact version of one cell. */
export interface CellRef {
    readonly kind: CellKind
    readonly key: string
    readonly version: number
}

/** The exact version of one graph. */
export interface GraphRef {
    readonly key: string
    readonly version: number
}

/** One argument of a confirmation read: taken from the original args, from the state before, or a literal. */
export interface ConfirmArg {
    readonly from: "args" | "before" | "value"
    readonly member?: string
    readonly value?: JsonValue
}

/** A read tool and where each of its arguments comes from. */
export interface ConfirmRead {
    readonly tool: string
    readonly args: Readonly<Record<string, ConfirmArg>>
}

/** How an unknown outcome of a write is settled by a read: the read, an optional read before the act, and what shows it happened. */
export interface ConfirmBy extends ConfirmRead {
    readonly before?: ConfirmRead
    readonly happened: { readonly member: string; readonly equals: string | number | boolean }
}

/** How a metered cell is priced: the usage unit and whether the price is reported by the serving account or fixed per unit. */
export interface MeteredBy {
    readonly usage: "tokens" | "units"
    readonly price: "reported" | { readonly usdPerUnit: number }
}

/** The behaviour facts of a cell; the engine judges a cell by these, never by what it is about (CELLS-PLAN 1.1, 1.4). */
export interface CellSemantics {
    /** The cell writes. */
    readonly mutates: boolean
    /** Writes outside NIVO's database; absent with `mutates` means outside (V1 default). */
    readonly outside?: boolean
    /** The same act may be sent again with the same key. */
    readonly repeatable?: boolean
    /** How an unknown outcome is checked by a read (V1 `ToolConfirmBy`, same shape). */
    readonly confirmBy?: ConfirmBy
    /** The refusal codes the cell may answer. */
    readonly refusals?: ReadonlyArray<string>
    /** The refusals that are final; a subset of `refusals`, writes only. */
    readonly finalRefusals?: ReadonlyArray<string>
    /** Members of the input that make an act unique. */
    readonly onceBy?: ReadonlyArray<string>
    /** Node only. */
    readonly readsHeldEvents?: true
    /** Node only: the only tools `ctx.tool` reaches. */
    readonly tools?: ReadonlyArray<string>
    /** Cost is booked when the cell is served through a platform-owned account. */
    readonly metered?: MeteredBy
    /** At most 600 000. */
    readonly timeoutMs?: number
}

/** Usage a metered cell reports. */
export interface UsageFigures {
    readonly units: number
    readonly usd?: number
    readonly model?: string
}

/** What a tool answered to a call: a value, or a refusal code with facts. The envelope may report the usage the call consumed (metered cells). */
export type ToolAnswer =
    | { readonly ok: true; readonly value: JsonValue; readonly usage?: ToolUsage }
    | { readonly ok: false; readonly refusal: string; readonly facts?: JsonObject; readonly usage?: ToolUsage }

/** The usage a tool call reports in its answer envelope, never in the business output: how many of which unit (`token`, `message`, ...). */
export type ToolUsage = { readonly units: number; readonly unit: string }

/** The intent key of ONE tool call (the ledger key of the call's position in the step): the door passes it on where a vendor replay key is needed. */
export interface ToolCallKey {
    readonly key: string
}

/** The recorded clock and random of a run: what a replay of the same intent uses instead of reading them again. */
export interface RunFacts {
    readonly now: string
    readonly randomSeed: string
}

/** The facts a run is given in place of a clock and a random source (the prelude fixes `Date.now` and `Math.random` on them). */
export interface RunnerFacts {
    readonly at: string
    readonly day: string
    readonly randomSeed: string
    readonly item: JsonValue
    readonly queue: ReadonlyArray<JsonObject>
    readonly waiting: number
    readonly workspace: JsonObject
}

/** The limits one source run is held to; on a cell row they may only go lower than the defaults. */
export interface RunnerLimits {
    readonly memoryBytes: number
    readonly stackBytes: number
    readonly cpuMs: number
    readonly wallMs: number
    readonly outputBytes: number
    readonly maxCalls: number
}

/** One example of a cell: an input, the scripted tool answers, and the outcome it expects. The generic test kit runs every one. */
export interface CellExample {
    readonly name: string
    readonly input: JsonValue
    readonly config?: JsonValue
    readonly facts?: Partial<RunnerFacts>
    readonly tools?: ReadonlyArray<{ readonly id: string; readonly args?: JsonValue; readonly answer: ToolAnswer }>
    readonly expect:
        { readonly ok: JsonValue } | { readonly ending: "cannot" | "declined" } | { readonly refused: string }
}

/** A cell as the engine reads it (never an entity). */
export interface CellDefinitionView extends CellRef {
    readonly id: string
    readonly packageKey: string
    readonly title: LocalizedText
    readonly inputSchema: JsonSchema
    readonly outputSchema: JsonSchema
    readonly configSchema: JsonSchema
    readonly semantics: CellSemantics
    readonly body: JsonObject
    readonly sourceSha256: string | null
    readonly examples: ReadonlyArray<CellExample>
    readonly definitionHash: string
    readonly reviewState: ReviewState
    readonly deleted: boolean
}

/** The stored logic text of a cell. */
export interface CellSourceView {
    readonly sha256: string
    readonly language: "js-quickjs@1"
    readonly text: string
}

/** The regions of the run memory (the LangGraph state of the thread, CELLS-DECISIONS D1). A cell never writes them directly. */
export type RunStateRegion = "trigger" | "steps" | "vars" | "item"

/** What the state keeps for one workflow variable: the value and who wrote it last, so a value stays traceable (D1). */
export interface RunVariable {
    readonly value: JsonValue
    /** The step key that wrote it last. */
    readonly by: string
    /** ISO instant of that write. */
    readonly at: string
}

/** One workflow variable a graph declares (D1): its JSON Schema and, for a list written by parallel branches, how writes merge. */
export interface GraphVarDeclaration {
    readonly schema: JsonSchema
    /** Absent: last write wins in step order, and two parallel branches writing it in one super-step is a seed-time problem. */
    readonly merge?: "append"
}

/**
 * A ref in a stored graph or expression. `$ref` is a path into one region of the run memory: `trigger.*`, `steps.<key>.output.*`,
 * `vars.<name>` (D1) or `item.*` (`item.$round` inside a loop).
 */
export interface StoredRef {
    readonly $ref: string
    readonly default?: JsonValue
    readonly round?: "previous"
}

/** A ref or a literal. */
export type RefOrValue = StoredRef | JsonValue

/** V1's stored condition expression, unchanged: `and` / `or` / `not` over `present`, `absent`, `eq` ... `contains`, depth at most 4. */
export type StoredExpr =
    | { readonly op: "present" | "absent"; readonly ref: StoredRef }
    | {
          readonly op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains"
          readonly ref: StoredRef
          readonly value: RefOrValue
          readonly caseFold?: true
      }
    | { readonly and: ReadonlyArray<StoredExpr> }
    | { readonly or: ReadonlyArray<StoredExpr> }
    | { readonly not: StoredExpr }

/** What an expression evaluates to; `unknown` takes the `no` branch. */
export type ExprTruth = true | false | "unknown"

/** One step of a graph; a node step names an EXACT cell version. */
export type CellGraphStep =
    | {
          readonly kind: "node"
          readonly cell: CellRef
          readonly input: Readonly<Record<string, RefOrValue>>
          readonly mode: "auto" | "ask"
          readonly accounts: ReadonlyArray<string>
          readonly next?: string
          readonly routes?: Readonly<Record<string, string>>
          readonly unsuccessful?: JsonObject
      }
    | {
          readonly kind: "core.if"
          readonly when: StoredExpr
          readonly yes: string
          readonly no?: string
          readonly label?: LocalizedText
      }
    | { readonly kind: "core.loop"; readonly config: JsonObject }
    | { readonly kind: "core.wait"; readonly config: JsonObject }
    | { readonly kind: "core.hand-back"; readonly config: JsonObject }
    | { readonly kind: "core.call-workflow"; readonly config: JsonObject }
    | { readonly kind: "core.outcome"; readonly config: JsonObject }
    | { readonly kind: "core.set"; readonly config: CoreSetConfig }

/** The config of `core.set` (D1): each name is a variable the graph declares; the value is a ref, an expression or a literal. */
export interface CoreSetConfig {
    readonly set: Readonly<Record<string, RefOrValue | StoredExpr>>
    /** The step that follows; absent: the set ends its region. */
    readonly next?: string
}

/** V1's stored GraphSpec shape; node steps carry an exact cell version. */
export interface CellGraphDocument {
    readonly start: string
    readonly triggers: ReadonlyArray<JsonObject>
    readonly steps: Readonly<Record<string, CellGraphStep>>
    /** The workflow variables the graph declares, name to declaration (D1); absent: none. A `core.set` or a `$ref` of another name is refused at seed time. */
    readonly vars?: Readonly<Record<string, GraphVarDeclaration>>
}

/** A graph as the engine reads it. */
export interface CellGraphView extends GraphRef {
    readonly id: string
    readonly document: CellGraphDocument
    readonly documentHash: string
    readonly deleted: boolean
}

/** What the engine does next after one execution (CELLS-PLAN 1.4). */
export type CellVerdict =
    | { readonly kind: "continue" }
    | { readonly kind: "unsuccessful"; readonly reason: string }
    | { readonly kind: "retry" }
    | { readonly kind: "repeat"; readonly key: string }
    | { readonly kind: "confirm"; readonly read: ConfirmRead }
    | {
          readonly kind: "stop"
          readonly why: "act_refused" | "outcome_unknown" | "failed" | "credits_exhausted"
          readonly retry?: "after_take_over"
      }

/** The facts of a failure the engine can classify. CHOICE of slice 0 (the plan names the type, not the members). */
export interface CauseFacts {
    /** A stable code of the cause. */
    readonly code: string
    /** A short English detail for the log, never shown to a person. */
    readonly detail?: string
}

/** What one execution answered (CELLS-PLAN 1.4). */
export type CellOutcome =
    | { readonly kind: "ok"; readonly output: JsonValue; readonly usage?: UsageFigures }
    | { readonly kind: "ending"; readonly reason: "cannot" | "declined"; readonly why?: string }
    | { readonly kind: "refused-final"; readonly code: string }
    | { readonly kind: "refused"; readonly code: string; readonly facts: JsonObject }
    | { readonly kind: "transient"; readonly cause: CauseFacts }
    | { readonly kind: "unknown"; readonly key: string }
    | { readonly kind: "failed"; readonly why: "confused" | "permanent" | "limits"; readonly cause?: CauseFacts }

/** Where and for whom one execution runs. */
export interface ExecuteScope {
    readonly workspaceId: string
    readonly runId: string
    readonly stepKey: string
    readonly attempt: number
    readonly enterprise: string | null
    readonly world: "live" | "sandbox"
}

/** One call of the one executor. */
export interface ExecuteRequest {
    readonly scope: ExecuteScope
    readonly cell: CellRef
    readonly input: JsonValue
    readonly config?: JsonValue
    /** The recorded clock and random; absent: the executor takes them from the clock port and the run scope and records them with the intent. */
    readonly facts?: RunFacts
}

/** A tool call a source made, kept by content so a re-run replays it. */
export interface RecordedCall {
    readonly call: number
    readonly tool: string
    readonly args: JsonValue
    readonly answer: ToolAnswer
}

/** The answer of the one executor. */
export interface ExecuteResult {
    readonly outcome: CellOutcome
    readonly verdict: CellVerdict
    readonly calls: ReadonlyArray<RecordedCall>
}

/** The messages the api sends to the runner process (JSON lines on stdin, CELLS-PLAN 4.3). */
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
          /** What the guest is given beside its input (`tool` gives `tool()` and `say()`); decided by the client from the cell kind, never by the source. */
          readonly capabilities: ReadonlyArray<RunnerCapability>
      }
    | { readonly type: "answer"; readonly id: string; readonly call: number; readonly answer: JsonValue }
    | { readonly type: "check"; readonly id: string; readonly source: string }

/** The messages the runner process sends back (JSON lines on stdout, CELLS-PLAN 4.3). */
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

/** A way out a run may be given; phase 0 has `tool` only (a provider kind adds its own names, e.g. `http`, in the client's table and nowhere else). */
export type RunnerCapability = "tool"

/**
 * The run request the `CellRunner` port takes: the wire `run` without its capabilities (the client decides them from `cellKind`), plus the tools the
 * cell declares (`semantics.tools`). No declared tool means no tool call: every `tool()` of the source is refused `CELLS_TOOL_UNDECLARED`.
 */
export type RunnerRunRequest = Omit<Extract<RunnerInbound, { readonly type: "run" }>, "capabilities"> & {
    readonly declaredTools?: ReadonlyArray<string>
    /** The kind of the cell; absent: by entry (`run` gets `tool`, `translate` nothing). */
    readonly cellKind?: CellKind
}

/** The terminal answers of a run. */
export type RunnerRunResult = Extract<RunnerOutbound, { readonly type: "done" | "ended" | "failed" }>

/** The `cells.package.yaml` of a package repository (CELLS-PLAN 3.2). */
export interface CellPackageFile {
    readonly key: string
    readonly version: string
    readonly visibility: "public" | "private"
    readonly enterprises?: ReadonlyArray<string>
    readonly author: string
}

/** The `cell.yaml` of one cell version (CELLS-PLAN 3.2). `source` is the file name beside it (`run.js`, `translate.js`). */
export interface CellFile {
    readonly kind: CellKind
    readonly key: string
    readonly version: number
    readonly title: LocalizedText
    readonly input: JsonSchema
    readonly output: JsonSchema
    readonly config?: JsonSchema
    readonly semantics: CellSemantics
    readonly body?: JsonObject
    readonly source?: string
    /** The TypeScript authoring file beside `source` (D3): it must exist, it is never loaded or stored; its reference is the source row's `authorRef`. */
    readonly origin?: string
    readonly examples?: ReadonlyArray<CellExample>
    /** `retired` retires the version; absent means `approved` (the seed publishes). CHOICE of slice 0. */
    readonly reviewState?: ReviewState
}

/** The `graph.yaml` of one graph version: the key, the version and the graph document. ADDITION of slice 0 (the plan names no graph file type). */
export interface CellGraphFile extends GraphRef, CellGraphDocument {
    /** Absent means `approved`. */
    readonly reviewState?: ReviewState
}

/** Where a seeded package was read from. */
export interface CellPackageOrigin {
    readonly repository: string
    readonly commit: string
}

/** A new source text to store (content-addressed by its sha256). */
export interface CellSourceInput {
    readonly text: string
    readonly authorKind: "nivo" | "package"
    readonly authorRef: string
}

/**
 * A cell that passed `CellValidationService` (S2) and is ready to write (S1). CHOICE of slice 0: the writer computes the hash; the
 * source is already stored (`putSource` answered its id) and its sha256 travels with it.
 */
export interface ValidatedCell extends CellRef {
    readonly title: LocalizedText
    readonly inputSchema: JsonSchema
    readonly outputSchema: JsonSchema
    readonly configSchema: JsonSchema
    readonly semantics: CellSemantics
    readonly body: JsonObject
    readonly source: { readonly id: string; readonly sha256: string } | null
    readonly examples: ReadonlyArray<CellExample>
    readonly reviewState: ReviewState
    /** `<repo>@<commit>` of a seeded row. */
    readonly reviewRef: string | null
}

/** A graph that passed validation and names exact cell versions only. CHOICE of slice 0: the writer derives the `triggers` column from the document. */
export interface ValidatedGraph extends GraphRef {
    readonly document: CellGraphDocument
    readonly reviewState: ReviewState
    readonly reviewRef: string | null
}

/** What one `cells-seed apply` did, cell by cell (seeds-and-data rules 9-10). */
export interface SeedReport {
    readonly created: ReadonlyArray<string>
    readonly unchanged: ReadonlyArray<string>
    readonly refused: ReadonlyArray<{
        readonly ref: string
        readonly code: CellsErrorCode
        readonly params: JsonObject
    }>
    readonly notInPackage: ReadonlyArray<string>
    /** The versions the package files mark `retired` that this apply moved to `retired` (or found retired). */
    readonly retired: ReadonlyArray<string>
}

/** The receipt of an applied package commit. */
export interface SeedReceiptInput {
    readonly packageKey: string
    readonly repository: string
    readonly commit: string
    readonly forced: boolean
    readonly report: SeedReport
}

/** What a listing is filtered by: approved, not deleted, visible to the enterprise. */
export interface CellListFilter {
    readonly kind?: CellKind
    readonly enterprise: string | null
}
