import { createHash } from "node:crypto"
import type { EntityManager } from "typeorm"
import type {
    CellDefinitionsWriter,
    CellDefinitionView,
    CellExecutor,
    CellGraphView,
    CellLedger,
    CellListFilter,
    CellMeter,
    CellOutcome,
    CellPackageFile,
    CellPackageOrigin,
    CellReader,
    CellRef,
    CellRunner,
    CellSourceInput,
    CellSourceView,
    CellToolDoor,
    ExecuteRequest,
    ExecuteResult,
    ExecuteScope,
    GraphRef,
    JsonValue,
    RunnerDoor,
    RunnerRunRequest,
    RunnerRunResult,
    SeedReceiptInput,
    ToolAnswer,
    UsageFigures,
    ValidatedCell,
    ValidatedGraph,
} from "@modules/domain/cells"
import { CellsError, CellsErrorCode } from "@modules/domain/cells"

/*
 * In-memory doubles of the cells ports (CELLS-PLAN 9.4: each slice develops against the contracts of the others before the real
 * implementations exist). Slice 0 owns this file; a slice that needs another behaviour writes its own double in its own builder file.
 */

/** The text of a ref in a message and in a map key: `kind:key@version`. */
export const refKeyOf = (ref: CellRef): string => `${ref.kind}:${ref.key}@${String(ref.version)}`

/** The text of a graph ref in a map key: `key@version`. */
export const graphKeyOf = (ref: GraphRef): string => `${ref.key}@${String(ref.version)}`

/** The sha256 hex of a text, as the real source store keys it. */
export const sha256Of = (text: string): string => createHash("sha256").update(text).digest("hex")

/** JSON text with the members of every object sorted, so two equal contents compare equal whatever their member order. */
export const canonicalJsonOf = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalJsonOf(item)).join(",")}]`
    if (typeof value === "object" && value !== null) {
        const members = Object.entries(value)
            .filter(([, member]) => member !== undefined)
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        return `{${members.map(([name, member]) => `${JSON.stringify(name)}:${canonicalJsonOf(member)}`).join(",")}}`
    }
    return JSON.stringify(value) ?? "null"
}

/** The reader over rows a spec adds; it answers like the real one except the enterprise filter (the view carries no package visibility). */
export class MemoryCellReader implements CellReader {
    private readonly definitions = new Map<string, CellDefinitionView>()
    private readonly graphs = new Map<string, CellGraphView>()
    private readonly sources = new Map<string, CellSourceView>()

    /** Adds (or replaces) a definition. */
    addDefinition(view: CellDefinitionView): CellDefinitionView {
        this.definitions.set(refKeyOf(view), view)
        return view
    }

    /** Adds (or replaces) a graph. */
    addGraph(view: CellGraphView): CellGraphView {
        this.graphs.set(graphKeyOf(view), view)
        return view
    }

    /** Adds a source and answers its view (the sha256 is computed from the text). */
    addSource(text: string): CellSourceView {
        const view: CellSourceView = { sha256: sha256Of(text), language: "js-quickjs@1", text }
        this.sources.set(view.sha256, view)
        return view
    }

    definition(ref: CellRef): Promise<CellDefinitionView> {
        const view = this.definitions.get(refKeyOf(ref))
        return view === undefined ? Promise.reject(unknownOf(refKeyOf(ref))) : Promise.resolve(view)
    }

    graph(ref: GraphRef): Promise<CellGraphView> {
        const view = this.graphs.get(graphKeyOf(ref))
        return view === undefined ? Promise.reject(unknownOf(graphKeyOf(ref))) : Promise.resolve(view)
    }

    source(sha256: string): Promise<CellSourceView> {
        const view = this.sources.get(sha256)
        return view === undefined ? Promise.reject(unknownOf(sha256)) : Promise.resolve(view)
    }

    listed(filter: CellListFilter): Promise<ReadonlyArray<CellRef>> {
        const refs = [...this.definitions.values()]
            .filter((view) => view.reviewState === "approved" && !view.deleted && (filter.kind === undefined || view.kind === filter.kind))
            .map((view): CellRef => ({ kind: view.kind, key: view.key, version: view.version }))
        return Promise.resolve(refs)
    }
}

/** The `CELLS_UNKNOWN` error for a ref text. */
const unknownOf = (ref: string): CellsError => new CellsError({ code: CellsErrorCode.Unknown, params: { ref } })

/** What the writer double kept of one call, in order. */
export interface WriterCall {
    readonly method: "putPackage" | "putSource" | "putDefinition" | "putGraph" | "retire" | "receipt"
    readonly key: string
}

/** The writer over maps: same content again is `unchanged`, other content for a kept (kind, key, version) throws `CELLS_VERSION_IMMUTABLE`. */
export class MemoryCellDefinitionsWriter implements CellDefinitionsWriter {
    readonly calls: Array<WriterCall> = []
    readonly receipts: Array<SeedReceiptInput> = []
    readonly retired: Array<string> = []
    private readonly packages = new Map<string, string>()
    private readonly sources = new Map<string, string>()
    private readonly definitions = new Map<string, string>()
    private readonly graphs = new Map<string, string>()

    putPackage(_manager: EntityManager, file: CellPackageFile, origin: CellPackageOrigin): Promise<string> {
        const key = `${file.key}@${file.version}:${origin.commit}`
        this.calls.push({ method: "putPackage", key })
        return Promise.resolve(this.idOf(this.packages, "package", key))
    }

    putSource(_manager: EntityManager, source: CellSourceInput): Promise<string> {
        const sha256 = sha256Of(source.text)
        this.calls.push({ method: "putSource", key: sha256 })
        return Promise.resolve(this.idOf(this.sources, "source", sha256))
    }

    putDefinition(_manager: EntityManager, packageId: string, candidate: ValidatedCell): Promise<"created" | "unchanged"> {
        const key = refKeyOf(candidate)
        this.calls.push({ method: "putDefinition", key })
        return this.settle(this.definitions, key, canonicalJsonOf({ packageId, candidate }), key)
    }

    putGraph(_manager: EntityManager, packageId: string, graph: ValidatedGraph): Promise<"created" | "unchanged"> {
        const key = graphKeyOf(graph)
        this.calls.push({ method: "putGraph", key })
        return this.settle(this.graphs, key, canonicalJsonOf({ packageId, graph }), key)
    }

    retire(_manager: EntityManager, ref: CellRef): Promise<void> {
        this.calls.push({ method: "retire", key: refKeyOf(ref) })
        this.retired.push(refKeyOf(ref))
        return Promise.resolve()
    }

    receipt(_manager: EntityManager, receipt: SeedReceiptInput): Promise<void> {
        this.calls.push({ method: "receipt", key: `${receipt.packageKey}@${receipt.commit}` })
        this.receipts.push(receipt)
        return Promise.resolve()
    }

    /** The id kept for a key, or a new `<prefix>-<n>` one. */
    private idOf(ids: Map<string, string>, prefix: string, key: string): string {
        const kept = ids.get(key)
        if (kept !== undefined) return kept
        const id = `${prefix}-${String(ids.size + 1)}`
        ids.set(key, id)
        return id
    }

    /** `created` for a new key, `unchanged` for the same content, a refusal for other content. */
    private settle(kept: Map<string, string>, key: string, content: string, ref: string): Promise<"created" | "unchanged"> {
        const before = kept.get(key)
        if (before === undefined) {
            kept.set(key, content)
            return Promise.resolve("created")
        }
        if (before === content) return Promise.resolve("unchanged")
        return Promise.reject(new CellsError({ code: CellsErrorCode.VersionImmutable, params: { ref } }))
    }
}

/** What a scripted runner is told to do for one `run`. */
export type ScriptedRunnerRun = (request: RunnerRunRequest, door: RunnerDoor) => Promise<RunnerRunResult>

/** The runner a spec scripts: `run` calls the handler it was given; `check` answers the problems it was given. Every request is kept. */
export class ScriptedCellRunner implements CellRunner {
    readonly runs: Array<RunnerRunRequest> = []
    readonly checked: Array<string> = []

    constructor(
        private readonly handler: ScriptedRunnerRun = (request) => Promise.resolve({ type: "done", id: request.id, output: null }),
        private readonly problems: ReadonlyArray<string> = [],
    ) {}

    run(request: RunnerRunRequest, door: RunnerDoor): Promise<RunnerRunResult> {
        this.runs.push(request)
        return this.handler(request, door)
    }

    check(source: string): Promise<ReadonlyArray<string>> {
        this.checked.push(source)
        return Promise.resolve(this.problems)
    }
}

/** The ledger over a map with the real semantics: once per key, a pending key answers `unknown`, a throw releases unless `outcomeUnknown`. */
export class MemoryCellLedger implements CellLedger {
    private readonly entries = new Map<string, { readonly settled: CellOutcome | null }>()

    async once(key: string, act: () => Promise<CellOutcome>): Promise<{ readonly replayed: boolean; readonly outcome: CellOutcome }> {
        const entry = this.entries.get(key)
        if (entry !== undefined) {
            return { replayed: true, outcome: entry.settled ?? { kind: "unknown", key } }
        }
        this.entries.set(key, { settled: null })
        try {
            const outcome = await act()
            this.entries.set(key, { settled: outcome })
            return { replayed: false, outcome }
        } catch (cause: unknown) {
            if (Reflect.get(Object(cause), "outcomeUnknown") !== 1) this.entries.delete(key)
            throw cause
        }
    }

    /** The keys the ledger holds, settled or pending. */
    keys(): ReadonlyArray<string> {
        return [...this.entries.keys()]
    }
}

/** One booking the meter double kept. */
export interface MeterBooking {
    readonly workspaceId: string
    readonly cell: CellRef
    readonly usage: UsageFigures
    readonly billed: boolean
}

/** The meter over one credit balance per workspace (units): a booking that is billed draws it down, a failed try is kept and not billed. */
export class MemoryCellMeter implements CellMeter {
    readonly bookings: Array<MeterBooking> = []
    private readonly balances = new Map<string, number>()

    /** Sets the pool of a workspace (units). A workspace with no pool set has none. */
    fund(workspaceId: string, units: number): void {
        this.balances.set(workspaceId, units)
    }

    /** The pool left of a workspace. */
    balanceOf(workspaceId: string): number {
        return this.balances.get(workspaceId) ?? 0
    }

    allows(workspaceId: string, _cell: CellRef, estimate: UsageFigures | null): Promise<boolean> {
        const balance = this.balanceOf(workspaceId)
        return Promise.resolve(balance > 0 && (estimate === null || balance >= estimate.units))
    }

    book(workspaceId: string, cell: CellRef, usage: UsageFigures, billed: boolean): Promise<void> {
        this.bookings.push({ workspaceId, cell, usage, billed })
        if (billed) this.balances.set(workspaceId, this.balanceOf(workspaceId) - usage.units)
        return Promise.resolve()
    }
}

/** One call the tool door double took. */
export interface DoorCall {
    readonly scope: ExecuteScope
    readonly tool: string
    readonly args: JsonValue
}

/** An answer, or a function of the args that answers. */
export type ScriptedToolAnswer = ToolAnswer | ((args: JsonValue) => ToolAnswer)

/** The tool door scripted by tool name; a tool nobody scripted is refused with `tool_unscripted` (a refusal is an answer, never a throw). */
export class ScriptedCellToolDoor implements CellToolDoor {
    readonly calls: Array<DoorCall> = []

    constructor(private readonly answers: Readonly<Record<string, ScriptedToolAnswer>> = {}) {}

    call(scope: ExecuteScope, tool: string, args: JsonValue): Promise<ToolAnswer> {
        this.calls.push({ scope, tool, args })
        const scripted = this.answers[tool]
        if (scripted === undefined) return Promise.resolve({ ok: false, refusal: "tool_unscripted" })
        return Promise.resolve(typeof scripted === "function" ? scripted(args) : scripted)
    }
}

/** What a scripted executor does for one request. */
export type ScriptedExecuteHandler = (request: ExecuteRequest) => Promise<ExecuteResult>

/** The executor a spec scripts; the default answers a permanent failure and a `failed` stop, so an unscripted call is visible. */
export class ScriptedCellExecutor implements CellExecutor {
    readonly requests: Array<ExecuteRequest> = []

    constructor(
        private readonly handler: ScriptedExecuteHandler = () =>
            Promise.resolve({
                outcome: { kind: "failed", why: "permanent", cause: { code: "executor_unscripted" } },
                verdict: { kind: "stop", why: "failed" },
                calls: [],
            }),
    ) {}

    execute(request: ExecuteRequest): Promise<ExecuteResult> {
        this.requests.push(request)
        return this.handler(request)
    }
}
