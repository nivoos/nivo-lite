import type {
    AuthorProject,
    ConfigData,
    CellFileData,
    GraphFileData,
    GraphStepData,
    GraphVarData,
    JsonObject,
    JsonValue,
    LocalizedText,
    PackageFileData,
    RefOrValue,
    StoredExpr,
    StoredRef,
} from "./types"

/** A ref into the run memory: `trigger.*`, `steps.<key>.output.*`, `vars.<name>`, `item.*`. */
export const ref = (path: string, options: { readonly default?: JsonValue; readonly round?: "previous" } = {}): StoredRef => ({
    $ref: path,
    ...(options.default === undefined ? {} : { default: options.default }),
    ...(options.round === undefined ? {} : { round: options.round }),
})

/** The expression builders (`when.eq(ref("steps.a.output.x"), 1)`); `and`, `or`, `not` nest to the depth the seed accepts. */
export const when = {
    present: (target: StoredRef): StoredExpr => ({ op: "present", ref: target }),
    absent: (target: StoredRef): StoredExpr => ({ op: "absent", ref: target }),
    eq: (target: StoredRef, value: RefOrValue): StoredExpr => ({ op: "eq", ref: target, value }),
    ne: (target: StoredRef, value: RefOrValue): StoredExpr => ({ op: "ne", ref: target, value }),
    gt: (target: StoredRef, value: RefOrValue): StoredExpr => ({ op: "gt", ref: target, value }),
    gte: (target: StoredRef, value: RefOrValue): StoredExpr => ({ op: "gte", ref: target, value }),
    lt: (target: StoredRef, value: RefOrValue): StoredExpr => ({ op: "lt", ref: target, value }),
    lte: (target: StoredRef, value: RefOrValue): StoredExpr => ({ op: "lte", ref: target, value }),
    contains: (target: StoredRef, value: RefOrValue, options: { readonly caseFold?: true } = {}): StoredExpr => ({
        op: "contains",
        ref: target,
        value,
        ...(options.caseFold === undefined ? {} : { caseFold: options.caseFold }),
    }),
    and: (...parts: ReadonlyArray<StoredExpr>): StoredExpr => ({ and: parts }),
    or: (...parts: ReadonlyArray<StoredExpr>): StoredExpr => ({ or: parts }),
    not: (part: StoredExpr): StoredExpr => ({ not: part }),
}

/** A node step: the exact cell version, its mapped input, the next step or the routes. */
export const node = (
    cell: { readonly key: string; readonly version: number },
    options: {
        readonly input?: Readonly<Record<string, RefOrValue>>
        readonly mode?: "auto" | "ask"
        readonly accounts?: ReadonlyArray<string>
        readonly next?: string
        readonly routes?: Readonly<Record<string, string>>
        readonly unsuccessful?: JsonObject
    } = {},
): GraphStepData => ({
    kind: "node",
    cell: { kind: "node", key: cell.key, version: cell.version },
    input: options.input ?? {},
    mode: options.mode ?? "auto",
    accounts: options.accounts ?? [],
    ...(options.next === undefined ? {} : { next: options.next }),
    ...(options.routes === undefined ? {} : { routes: options.routes }),
    ...(options.unsuccessful === undefined ? {} : { unsuccessful: options.unsuccessful }),
})

/** `if` is a reserved word in JavaScript, so the export is `ifNode`, as in V1. `unknown` takes the `no` branch. */
export const ifNode = (options: { readonly when: StoredExpr; readonly yes: string; readonly no?: string; readonly label?: LocalizedText }): GraphStepData => ({
    kind: "core.if",
    when: options.when,
    yes: options.yes,
    ...(options.no === undefined ? {} : { no: options.no }),
    ...(options.label === undefined ? {} : { label: options.label }),
})

/** A loop step: its whole config (`over`/`key`/`max`/`concurrency`, or `until`/`max`/`every`/`exhausted`, the `body` graph, `next`). */
export const loop = (config: ConfigData): GraphStepData => ({ kind: "core.loop", config })
/** A wait step. */
export const wait = (config: ConfigData): GraphStepData => ({ kind: "core.wait", config })
/** A hand-back step. */
export const handBack = (config: ConfigData): GraphStepData => ({ kind: "core.hand-back", config })
/** A call-workflow step. */
export const call = (config: ConfigData): GraphStepData => ({ kind: "core.call-workflow", config })
/** An outcome step. */
export const outcome = (config: ConfigData): GraphStepData => ({ kind: "core.outcome", config })
/** A `core.set` step (CELLS-DECISIONS D1): each name is a variable the graph declares in `vars`. */
export const set = (values: Readonly<Record<string, RefOrValue | StoredExpr>>, options: { readonly next?: string } = {}): GraphStepData => ({
    kind: "core.set",
    config: { set: values, ...(options.next === undefined ? {} : { next: options.next }) },
})

/**
 * `tool()` as a step (the generic node `core.call-tool`) is HELD behind the owner's ruling on question 4 of CELLS-PLAN 10 (it changes
 * engine-core rule 4): it is not exported until that ruling.
 */

/** A graph file. */
export const graph = (definition: {
    readonly key: string
    readonly version: number
    readonly start: string
    readonly triggers?: ReadonlyArray<JsonObject>
    readonly steps: Readonly<Record<string, GraphStepData>>
    readonly vars?: Readonly<Record<string, GraphVarData>>
    readonly reviewState?: "draft" | "approved" | "retired"
}): GraphFileData => ({
    key: definition.key,
    version: definition.version,
    start: definition.start,
    triggers: definition.triggers ?? [],
    steps: definition.steps,
    ...(definition.vars === undefined ? {} : { vars: definition.vars }),
    ...(definition.reviewState === undefined ? {} : { reviewState: definition.reviewState }),
})

/** A cell file (the data of one cell version); `source: "run.js"` names the compiled text beside it, compiled from `run.ts`. */
export const cellFile = (definition: CellFileData): CellFileData => definition

/** The package file. */
export const packageFile = (definition: PackageFileData): PackageFileData => definition

/** The whole project an author hands to `emit`. */
export const project = (definition: AuthorProject): AuthorProject => definition
