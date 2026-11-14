import { parse } from "yaml"
import type {
    CellFile,
    CellGraphFile,
    CellKind,
    CellPackageFile,
    CellRef,
    JsonObject,
    JsonSchema,
    ReviewState,
    ValidatedCell,
    ValidatedGraph,
} from "./cells.contracts"
import { CellsError, CellsErrorCode } from "./errors/cells.error"

/** The text files of one package checkout, by repository-relative path with forward slashes (`cells/tool/x/v1/cell.yaml`). */
export type CellPackageFiles = ReadonlyMap<string, string>

/** One cell version as the files give it: the parsed `cell.yaml` and the text of the source file beside it. */
export interface PackageCell {
    /** The directory of the cell version (`cells/<kind>/<key>/v<version>`). */
    readonly dir: string
    readonly file: CellFile
    /** The source text, or null when the file names none. */
    readonly sourceText: string | null
    /** The authoring file the compiled source came from (`run.ts`), named in `cell.yaml`; never loaded, only referenced (D3). */
    readonly origin: string | null
}

/** One graph version as the files give it. */
export interface PackageGraph {
    readonly dir: string
    readonly file: CellGraphFile
}

/** A file that could not be read as what its place says it is; the seed refuses that one thing and reports it. */
export interface PackageFault {
    /** The directory of the cell or graph version. */
    readonly dir: string
    /** The file at fault. */
    readonly file: string
    readonly reason: string
}

/** A whole package read from its files; nothing here is judged yet. */
export interface CellPackageContent {
    readonly manifest: CellPackageFile
    readonly cells: ReadonlyArray<PackageCell>
    readonly graphs: ReadonlyArray<PackageGraph>
    readonly faults: ReadonlyArray<PackageFault>
}

/** The manifest's file name and the places cells and graphs live (CELLS-PLAN 3.2). */
export const PACKAGE_FILE = "cells.package.yaml"
const CELL_FILE = /^(cells\/([^/]+)\/([^/]+)\/v(\d+))\/cell\.yaml$/u
const GRAPH_FILE = /^(graphs\/([^/]+)\/v(\d+))\/graph\.yaml$/u

const KIND_TABLE: Readonly<Record<CellKind, true>> = {
    operation: true,
    tool: true,
    node: true,
    trigger: true,
    provider: true,
    "core.if": true,
    "core.loop": true,
    "core.wait": true,
    "core.hand-back": true,
    "core.call-workflow": true,
    "core.outcome": true,
    "core.set": true,
}
const KINDS: ReadonlySet<string> = new Set(Object.keys(KIND_TABLE))
const REVIEW_STATES: ReadonlySet<string> = new Set<ReviewState>(["draft", "approved", "retired"])
const STEP_KINDS: ReadonlySet<string> = new Set(["node", "core.if", "core.loop", "core.wait", "core.hand-back", "core.call-workflow", "core.outcome", "core.set"])
const PACKAGE_KEY = /^[a-z][a-z0-9-]{1,39}$/u
const SEMVER = /^\d+\.\d+\.\d+$/u
const SOURCE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.js$/u
const CELL_MEMBERS: ReadonlySet<string> = new Set(["kind", "key", "version", "title", "input", "output", "config", "semantics", "body", "source", "origin", "examples", "reviewState"])
const GRAPH_MEMBERS: ReadonlySet<string> = new Set(["key", "version", "start", "triggers", "steps", "vars", "reviewState"])
const PACKAGE_MEMBERS: ReadonlySet<string> = new Set(["key", "version", "visibility", "enterprises", "author"])
/** The schema of a cell that declares no settings: an empty object. */
const NO_CONFIG: JsonSchema = { type: "object", properties: {}, additionalProperties: false }

type Plain = { readonly [member: string]: unknown }

const isPlain = (value: unknown): value is Plain => typeof value === "object" && value !== null && !Array.isArray(value)

const isText = (value: unknown): value is string => typeof value === "string" && value.trim() !== ""

/** Parses a yaml text; a text that does not parse throws `CELLS_PACKAGE_INVALID` naming the file. */
const parseYaml = (text: string, file: string): unknown => {
    try {
        return parse(text)
    } catch (cause: unknown) {
        throw new CellsError({ code: CellsErrorCode.PackageInvalid, params: { file, reason: cause instanceof Error ? cause.message.split("\n")[0] ?? "unreadable" : "unreadable" }, cause })
    }
}

const invalid = (file: string, reason: string): never => {
    throw new CellsError({ code: CellsErrorCode.PackageInvalid, params: { file, reason } })
}

/** Normalizes the line ends of a text file to `\n`, so a checkout on another system stores and hashes the same bytes. */
const normalized = (text: string): string => text.replaceAll("\r\n", "\n")

/** The reason an unknown member sits in a file, or null. */
const strayOf = (document: Plain, known: ReadonlySet<string>): string | null => {
    const stray = Object.keys(document).find((name) => !known.has(name))
    return stray === undefined ? null : `unknown member ${stray}`
}

/**
 * Reads `cells.package.yaml`. A package with no manifest, or an invalid one, is refused whole with `CELLS_PACKAGE_INVALID`: nothing can be
 * seeded without knowing whose it is and who may see it.
 */
export const readPackageManifest = (files: CellPackageFiles): CellPackageFile => {
    const text = files.get(PACKAGE_FILE)
    if (text === undefined) return invalid(PACKAGE_FILE, "missing")
    const document = parseYaml(text, PACKAGE_FILE)
    if (!isPlain(document)) return invalid(PACKAGE_FILE, "must be a mapping")
    const stray = strayOf(document, PACKAGE_MEMBERS)
    if (stray !== null) return invalid(PACKAGE_FILE, stray)
    const { key, version, visibility, enterprises, author } = document
    if (typeof key !== "string" || !PACKAGE_KEY.test(key)) return invalid(PACKAGE_FILE, "key: lowercase words and dashes")
    if (typeof version !== "string" || !SEMVER.test(version)) return invalid(PACKAGE_FILE, "version: major.minor.patch")
    if (visibility !== "public" && visibility !== "private") return invalid(PACKAGE_FILE, "visibility: public or private")
    if (!isText(author)) return invalid(PACKAGE_FILE, "author: required")
    if (visibility === "public" && enterprises !== undefined) return invalid(PACKAGE_FILE, "enterprises: only a private package names them")
    if (visibility === "private" && !(Array.isArray(enterprises) && enterprises.length > 0 && enterprises.every(isText))) return invalid(PACKAGE_FILE, "enterprises: a private package names at least one")
    return visibility === "public" ? { key, version, visibility, author } : { key, version, visibility, author, enterprises: enterprises as ReadonlyArray<string> }
}

/** The reason the shape of a `cell.yaml` is wrong for its place, or null; the meaning of its parts is `CellValidationService`'s. */
const cellShapeProblem = (document: Plain, match: RegExpExecArray): string | null => {
    const stray = strayOf(document, CELL_MEMBERS)
    if (stray !== null) return stray
    const [, , kind, key, version] = match
    if (document.kind !== kind || !KINDS.has(String(kind))) return `kind: must be ${String(kind)} as its folder says (one of the cell kinds)`
    if (document.key !== key) return `key: must be ${String(key)} as its folder says`
    if (document.version !== Number(version) || Number(version) < 1) return `version: must be ${String(version)} as its folder says`
    const { title, input, output, config, semantics, body, source, examples, reviewState } = document
    if (!(isPlain(title) && isText(title.vi) && isText(title.en))) return "title: needs vi and en"
    if (!isPlain(input) || !isPlain(output) || !isPlain(semantics)) return "input, output and semantics: must be mappings"
    if (config !== undefined && !isPlain(config)) return "config: must be a mapping"
    if (body !== undefined && !isPlain(body)) return "body: must be a mapping"
    if (source !== undefined && !(typeof source === "string" && SOURCE_NAME.test(source))) return "source: a file name ending .js, beside cell.yaml"
    const { origin } = document
    if (origin !== undefined && !(typeof origin === "string" && /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.ts$/u.test(origin) && source !== undefined)) return "origin: a .ts file name beside cell.yaml, only with a source"
    if (examples !== undefined && !(Array.isArray(examples) && examples.every(isPlain))) return "examples: must be a list of mappings"
    if (reviewState !== undefined && !REVIEW_STATES.has(String(reviewState))) return "reviewState: draft, approved or retired"
    return null
}

/** The reason the shape of a `graph.yaml` is wrong for its place, or null. */
const graphShapeProblem = (document: Plain, match: RegExpExecArray): string | null => {
    const stray = strayOf(document, GRAPH_MEMBERS)
    if (stray !== null) return stray
    const [, , key, version] = match
    if (document.key !== key) return `key: must be ${String(key)} as its folder says`
    if (document.version !== Number(version) || Number(version) < 1) return `version: must be ${String(version)} as its folder says`
    if (!isText(document.start)) return "start: required"
    if (!Array.isArray(document.triggers)) return "triggers: must be a list"
    if (!isPlain(document.steps)) return "steps: must be a mapping"
    const bad = Object.entries(document.steps).find(([, step]) => !(isPlain(step) && STEP_KINDS.has(String(step.kind))))
    if (bad !== undefined) return `steps.${bad[0]}.kind: one of ${[...STEP_KINDS].join(", ")}`
    if (document.vars !== undefined && !isPlain(document.vars)) return "vars: must be a mapping"
    if (document.reviewState !== undefined && document.reviewState !== "draft" && document.reviewState !== "approved") return "reviewState: draft or approved (the seed does not retire a graph)"
    return null
}

/** Reads one `cell.yaml` and its source; a problem is a fault of that one cell. */
const readCell = (path: string, text: string, files: CellPackageFiles, match: RegExpExecArray): PackageCell | PackageFault => {
    const dir = String(match[1])
    try {
        const document = parseYaml(text, path)
        if (!isPlain(document)) return { dir, file: path, reason: "must be a mapping" }
        const problem = cellShapeProblem(document, match)
        if (problem !== null) return { dir, file: path, reason: problem }
        const file = document as unknown as CellFile
        const origin = isPlain(document) && typeof document.origin === "string" ? document.origin : null
        if (origin !== null && !files.has(`${dir}/${origin}`)) return { dir, file: `${dir}/${origin}`, reason: "the origin file named in cell.yaml is missing" }
        if (file.source === undefined) return { dir, file, sourceText: null, origin }
        const sourceText = files.get(`${dir}/${file.source}`)
        return sourceText === undefined ? { dir, file: `${dir}/${file.source}`, reason: "the source file named in cell.yaml is missing" } : { dir, file, sourceText: normalized(sourceText), origin }
    } catch (cause: unknown) {
        if (cause instanceof CellsError) return { dir, file: path, reason: String(cause.params.reason ?? "unreadable") }
        throw cause
    }
}

/** Reads one `graph.yaml`. */
const readGraph = (path: string, text: string, match: RegExpExecArray): PackageGraph | PackageFault => {
    const dir = String(match[1])
    try {
        const document = parseYaml(text, path)
        if (!isPlain(document)) return { dir, file: path, reason: "must be a mapping" }
        const problem = graphShapeProblem(document, match)
        return problem === null ? { dir, file: document as unknown as CellGraphFile } : { dir, file: path, reason: problem }
    } catch (cause: unknown) {
        if (cause instanceof CellsError) return { dir, file: path, reason: String(cause.params.reason ?? "unreadable") }
        throw cause
    }
}

const isFault = (found: PackageCell | PackageGraph | PackageFault): found is PackageFault => typeof found.file === "string"

/**
 * Reads a package checkout into cells, graphs and faults (CELLS-PLAN 3.2): `cells.package.yaml`, `cells/<kind>/<key>/v<n>/cell.yaml` with its
 * source beside it, `graphs/<key>/v<n>/graph.yaml`. Every other file (readme, tsconfig, the author helper's files) is not part of the seed. A
 * cell or graph whose files do not read as their folder says is a fault of that one version; only a bad manifest refuses the whole package.
 * Pure: it reads the map it is given, in path order.
 */
export const readCellPackage = (files: CellPackageFiles): CellPackageContent => {
    const manifest = readPackageManifest(files)
    const cells: Array<PackageCell> = []
    const graphs: Array<PackageGraph> = []
    const faults: Array<PackageFault> = []
    for (const path of [...files.keys()].sort()) {
        const text = files.get(path) ?? ""
        const cellMatch = CELL_FILE.exec(path)
        const graphMatch = GRAPH_FILE.exec(path)
        const found = cellMatch !== null ? readCell(path, text, files, cellMatch) : graphMatch !== null ? readGraph(path, text, graphMatch) : null
        if (found === null) continue
        if (isFault(found)) faults.push(found)
        else if ("sourceText" in found) cells.push(found)
        else graphs.push(found)
    }
    return { manifest, cells, graphs, faults }
}

/** The text of a cell ref in a report: `kind:key@version`. */
export const cellRefText = (ref: CellRef): string => `${ref.kind}:${ref.key}@${String(ref.version)}`

/** The text of a graph ref in a report: `graph:key@version`. */
export const graphRefText = (graph: { readonly key: string; readonly version: number }): string => `graph:${graph.key}@${String(graph.version)}`

/** The row a validated cell file becomes; the source (stored first, so its id is known) travels with its sha256. */
export const validatedCellOf = (file: CellFile, source: ValidatedCell["source"], reviewRef: string): ValidatedCell => ({
    kind: file.kind,
    key: file.key,
    version: file.version,
    title: file.title,
    inputSchema: file.input,
    outputSchema: file.output,
    configSchema: file.config ?? NO_CONFIG,
    semantics: file.semantics,
    body: file.body ?? ({} satisfies JsonObject),
    source,
    examples: file.examples ?? [],
    reviewState: file.reviewState === "retired" ? "approved" : (file.reviewState ?? "approved"),
    reviewRef,
})

/** The row a validated graph file becomes. */
export const validatedGraphOf = (file: CellGraphFile, reviewRef: string): ValidatedGraph => ({
    key: file.key,
    version: file.version,
    document: {
        start: file.start,
        triggers: file.triggers,
        steps: file.steps,
        ...(file.vars === undefined ? {} : { vars: file.vars }),
    },
    reviewState: file.reviewState ?? "approved",
    reviewRef,
})
