import { readdirSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import type { CellProofWorld, CellProofWorlds, ProofDoorCall, ProofObservation, ProofToolReply } from "@modules/domain/cells/cell-proof.contracts"
import { CellExecutorService } from "@modules/domain/cells/cell-executor.service"
import { CellExpressionPolicy } from "@modules/domain/cells/cell-expression.policy"
import { CellJsonSchemaPolicy } from "@modules/domain/cells/cell-json-schema.policy"
import { readCellPackage, type PackageCell } from "@modules/domain/cells/cell-package-files.mapper"
import { CellRunnerClient, readDirsOf } from "@modules/domain/cells/cell-runner.client"
import { MemoryCellLedgerClient } from "@modules/domain/cells/memory-cell-ledger.client"
import { MemoryCellMeterClient } from "@modules/domain/cells/memory-cell-meter.client"
import type {
    CellDefinitionView,
    CellRunner,
    CellToolDoor,
    ExecuteScope,
    JsonValue,
    RunnerDoor,
    RunnerLimits,
    RunnerRunRequest,
    RunnerRunResult,
    ToolAnswer,
    ToolCallKey,
} from "@modules/domain/cells"
import { MemoryCellReader, sha256Of } from "./cells.builder"

/*
 * The worlds of the generic test kit (slice S5): the REAL executor wired to memory adapters, a tool door the kit scripts, and a runner you choose
 * (the real isolated process, or a double). Also the reader of a fixture package folder: its rows, from the files alone.
 */

/** The limits of a proof world: small, so an endless loop or a runaway allocation ends within a second or two. */
export const PROOF_LIMITS: RunnerLimits = { memoryBytes: 32 << 20, stackBytes: 1 << 20, cpuMs: 500, wallMs: 1500, outputBytes: 262_144, maxCalls: 50 }

const NOW = new Date("2026-01-02T03:04:05.000Z")

/** The real runner process of `packages/cell-runner` (built with `npx tsc -p packages/cell-runner/tsconfig.build.json`). */
export const realRunnerOf = (): CellRunnerClient => {
    const entry = join(__dirname, "../../../../../packages/cell-runner/dist/main.js")
    return new CellRunnerClient({ limits: PROOF_LIMITS, poolSize: 2, entry, readDirs: readDirsOf(entry) })
}

/** A runner that counts how many times a source was run, in front of any runner. */
class CountingRunner implements CellRunner {
    runs = 0

    constructor(private readonly inner: CellRunner) {}

    run(request: RunnerRunRequest, door: RunnerDoor): Promise<RunnerRunResult> {
        this.runs += 1
        return this.inner.run(request, door)
    }

    check(source: string): Promise<ReadonlyArray<string>> {
        return this.inner.check(source)
    }
}

/** The tool door the kit scripts: it records every call with its intent key and answers from the script by tool name and call number. */
class ScriptedProofDoor implements CellToolDoor {
    readonly calls: Array<ProofDoorCall> = []
    replies: Readonly<Record<string, ProofToolReply>> = {}
    private readonly counts = new Map<string, number>()

    call(_scope: ExecuteScope, tool: string, args: JsonValue, call: ToolCallKey): Promise<ToolAnswer> {
        this.calls.push({ tool, args, key: call.key })
        const nth = this.counts.get(tool) ?? 0
        this.counts.set(tool, nth + 1)
        const reply = this.replies[tool]
        if (reply === undefined) return Promise.resolve({ ok: false, refusal: "tool_unscripted" })
        return Promise.resolve(typeof reply === "function" ? reply(args, nth) : reply)
    }
}

class ProofWorld implements CellProofWorld {
    readonly executor: CellExecutorService
    private readonly reader = new MemoryCellReader()
    private readonly door = new ScriptedProofDoor()
    private readonly meter = new MemoryCellMeterClient()
    private readonly runner: CountingRunner

    constructor(runner: CellRunner, limits: RunnerLimits) {
        this.runner = new CountingRunner(runner)
        this.executor = new CellExecutorService(
            this.reader,
            this.runner,
            new MemoryCellLedgerClient(),
            this.meter,
            this.door,
            limits,
            { now: () => NOW },
            { info: () => undefined, warn: () => undefined, error: () => undefined },
            new CellExpressionPolicy(),
            new CellJsonSchemaPolicy(),
        )
    }

    install(rows: ReadonlyArray<CellDefinitionView>, sources: ReadonlyArray<string>): void {
        for (const text of sources) this.reader.addSource(text)
        for (const row of rows) this.reader.addDefinition(row)
    }

    script(replies: Readonly<Record<string, ProofToolReply>>): void {
        this.door.replies = replies
    }

    fund(units: number): void {
        this.meter.fund("ws-proof", units)
    }

    observed(): ProofObservation {
        return {
            doorCalls: [...this.door.calls],
            sourceRuns: this.runner.runs,
            bookings: this.meter.bookings().map((booking) => ({ units: booking.usage.units, billed: booking.billed })),
        }
    }
}

/** The factory of worlds over one runner (shared by every world it opens). */
export class ProofWorlds implements CellProofWorlds {
    constructor(
        private readonly runner: CellRunner,
        private readonly limits: RunnerLimits = PROOF_LIMITS,
    ) {}

    open(): CellProofWorld {
        return new ProofWorld(this.runner, this.limits)
    }
}

/** One fixture package read from its folder: the rows the engine would read, and the source texts by sha256. */
export interface FixturePackage {
    readonly key: string
    readonly rows: ReadonlyArray<CellDefinitionView>
    readonly sources: ReadonlyMap<string, string>
}

const filesOf = (root: string, folder = ""): ReadonlyMap<string, string> => {
    const files = new Map<string, string>()
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
        const path = posix.join(folder, entry.name)
        if (entry.isDirectory()) for (const [name, text] of filesOf(root, path)) files.set(name, text)
        else if (/\.(?:yaml|js|ts)$/u.test(entry.name)) files.set(path, readFileSync(join(root, path), "utf8"))
    }
    return files
}

const viewOf = (cell: PackageCell, packageKey: string): CellDefinitionView => ({
    kind: cell.file.kind,
    key: cell.file.key,
    version: cell.file.version,
    id: `id-${cell.file.key}`,
    packageKey,
    title: cell.file.title,
    inputSchema: cell.file.input,
    outputSchema: cell.file.output,
    configSchema: cell.file.config ?? {},
    semantics: cell.file.semantics,
    body: cell.file.body ?? {},
    sourceSha256: cell.sourceText === null ? null : sha256Of(cell.sourceText),
    examples: cell.file.examples ?? [],
    definitionHash: "fixture",
    reviewState: "approved",
    deleted: false,
})

/** Reads a fixture package folder (`cells.package.yaml`, `cells/**`, `graphs/**`) into rows and sources, from its files alone. */
export const fixturePackageOf = (root: string): FixturePackage => {
    const content = readCellPackage(filesOf(root))
    if (content.faults.length > 0) throw new Error(`fixture package ${root} has faults: ${JSON.stringify(content.faults)}`)
    const sources = new Map<string, string>()
    for (const cell of content.cells) if (cell.sourceText !== null) sources.set(sha256Of(cell.sourceText), cell.sourceText)
    return { key: content.manifest.key, rows: content.cells.map((cell) => viewOf(cell, content.manifest.key)), sources }
}

/** A reader holding every row and source of a fixture package (what `CellProofService` reads a source text from). */
export const readerOfPackage = (pack: FixturePackage): MemoryCellReader => {
    const reader = new MemoryCellReader()
    for (const text of pack.sources.values()) reader.addSource(text)
    for (const row of pack.rows) reader.addDefinition(row)
    return reader
}
