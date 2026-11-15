import { Injectable, Optional } from "@nestjs/common"
import type { CellFile, CellKind, CellRef } from "./cells.contracts"
import { InjectCellReader, InjectCellRunner } from "./cells.decorators"
import type { CellReader } from "./cell-reader.port"
import type { CellRunner } from "./cell-runner.port"
import { CellsError, CellsErrorCode } from "./errors/cells.error"
import { bodyProblemOf } from "./cell-body-shape.policy"
import { graphProblemOf, nodeRefsOf, type GraphCellFact } from "./cell-graph.policy"
import { cellRefText, type PackageCell, type PackageGraph } from "./cell-package-files.mapper"
import { CellJsonSchemaPolicy } from "./cell-json-schema.policy"
import { semanticsProblemOf, toolKeysOf } from "./cell-semantics.policy"
import { scanSource } from "./cell-source-scan.policy"

/** The cells of the package already judged good, by `kind:key@version`: what a tool, a confirmation read or a graph step may name. */
export type AcceptedCells = ReadonlyMap<string, CellFile>

/** The file name and the entry function a kind's stored source has (CELLS-PLAN 3.2); a kind absent here has no logic. */
const SOURCES: Readonly<
    Partial<Record<CellKind, { readonly file: string; readonly entry: string; readonly required: boolean }>>
> = {
    node: { file: "run.js", entry: "run", required: true },
    trigger: { file: "translate.js", entry: "translate", required: false },
    operation: { file: "map.js", entry: "map", required: false },
}

/** The rule an async source breaks, as the seed reports it; `cells-author` refuses the same at compile time with the same words. */
const ASYNC_RULE = "async: a cell source is synchronous (tool() returns its answer; no async function, no await)"

const asText = (value: unknown): string => (typeof value === "string" ? value : String(value))

@Injectable()
/**
 * Every seed-time check of a cell and of a graph (CELLS-PLAN 3.2), as typed `CellsError` codes; the seed refuses the one thing that fails
 * and reports the rest. It runs at seed time and again at publish time. The kind of cell decides what it may carry (`source`, `tools`,
 * `body`); nothing here knows what a cell is ABOUT. The stored rows are read only for the cells a package names but does not hold itself,
 * and only when a reader is bound (`check` runs without a database).
 */
export class CellValidationService {
    constructor(
        @InjectCellRunner() private readonly runner: CellRunner,
        private readonly schemas: CellJsonSchemaPolicy,
        @Optional() @InjectCellReader() private readonly reader?: CellReader,
    ) {}

    /** Throws the typed error of the first thing wrong with the cell; answers nothing when it is good. */
    async validateCell(cell: PackageCell, accepted: AcceptedCells): Promise<void> {
        const { file } = cell
        const ref = cellRefText(file)
        this.checkSchemas(file, ref)
        const bodyProblem = bodyProblemOf(file.kind, file.body ?? {})
        if (bodyProblem !== null)
            throw new CellsError({ code: CellsErrorCode.BodyInvalid, params: { ref, path: bodyProblem } })
        await this.checkSemantics(file, ref, accepted)
        await this.checkSource(cell, ref)
        this.checkExamples(file, ref)
    }

    /** Throws the typed error of the first thing wrong with the graph; answers nothing when it is good. */
    async validateGraph(graph: PackageGraph, accepted: AcceptedCells): Promise<void> {
        const facts = new Map<string, GraphCellFact | null>()
        await Promise.all(
            nodeRefsOf(graph.file).map(async (ref) => facts.set(cellRefText(ref), await this.factOf(ref, accepted))),
        )
        const problem = graphProblemOf(graph.file, {
            cellOf: (ref) => facts.get(cellRefText(ref)) ?? null,
            schemaProblemOf: (schema) => this.schemas.schemaProblemOf(schema),
        })
        if (problem !== null) throw problem
    }

    /** The input, output and config schemas are JSON Schema; the input and the config describe an object. */
    private checkSchemas(file: CellFile, ref: string): void {
        const schemas: ReadonlyArray<readonly [string, unknown, boolean]> = [
            ["input", file.input, true],
            ["output", file.output, false],
            ["config", file.config ?? { type: "object" }, true],
        ]
        for (const [name, schema, describesObject] of schemas) {
            const found = this.schemas.schemaProblemOf(schema)
            const problem = found === null ? null : `${name}${found}`
            const notObject =
                describesObject && Reflect.get(Object(schema), "type") !== "object"
                    ? `${name}.type: must be object`
                    : null
            const path = problem ?? notObject
            if (path !== null) throw new CellsError({ code: CellsErrorCode.SchemaInvalid, params: { ref, path } })
        }
    }

    /** The semantics agree with themselves and the kind; the tools a node or a confirmation read names are tool cells. */
    private async checkSemantics(file: CellFile, ref: string, accepted: AcceptedCells): Promise<void> {
        const tools = new Map<string, { readonly mutates: boolean } | null>()
        await Promise.all(
            toolKeysOf(file.semantics).map(async (key) => tools.set(key, await this.toolFactOf(key, accepted))),
        )
        const properties = Reflect.get(file.input, "properties")
        const inputMembers = typeof properties === "object" && properties !== null ? Object.keys(properties) : null
        const reason = semanticsProblemOf(file.kind, file.semantics, {
            toolOf: (key) => tools.get(key) ?? null,
            inputMembers,
        })
        if (reason !== null) throw new CellsError({ code: CellsErrorCode.SemanticsInvalid, params: { ref, reason } })
    }

    /** A source exists exactly where the kind has logic, has no import, parses, declares its entry and calls only declared tools. */
    private async checkSource(cell: PackageCell, ref: string): Promise<void> {
        const { file, sourceText } = cell
        const kindSource = SOURCES[file.kind]
        const wrong = (reason: string): CellsError =>
            new CellsError({ code: CellsErrorCode.SemanticsInvalid, params: { ref, reason } })
        if (kindSource === undefined) {
            if (sourceText !== null) throw wrong("source_not_allowed")
            return
        }
        if (sourceText === null) {
            if (kindSource.required || (file.kind === "trigger" && file.body?.map === undefined))
                throw wrong("source_required")
            return
        }
        if (file.source !== kindSource.file) throw wrong(`source_must_be_named:${kindSource.file}`)
        const scan = scanSource(sourceText)
        if (scan.forbidden.length > 0) throw new CellsError({ code: CellsErrorCode.SourceImports, params: { ref } })
        const asyncAt = scan.asyncCode[0]
        if (asyncAt !== undefined)
            throw new CellsError({
                code: CellsErrorCode.SourceSyntax,
                params: { ref, detail: `${ASYNC_RULE} (at ${asyncAt})` },
            })
        const problems = [...scan.syntax, ...(await this.runner.check(sourceText))]
        const syntax = problems[0]
        if (syntax !== undefined)
            throw new CellsError({ code: CellsErrorCode.SourceSyntax, params: { ref, detail: syntax } })
        if (!scan.functions.includes(kindSource.entry))
            throw new CellsError({
                code: CellsErrorCode.SourceSyntax,
                params: { ref, detail: `function ${kindSource.entry} is not declared` },
            })
        const declared = file.kind === "node" ? (file.semantics.tools ?? []) : []
        const undeclared = scan.toolCalls.find((tool) => !declared.includes(tool))
        if (undeclared !== undefined)
            throw new CellsError({ code: CellsErrorCode.ToolUndeclared, params: { ref, tool: undeclared } })
    }

    /** The examples are well formed and name only the refusals and tools the cell declares; running them is the test kit's. */
    private checkExamples(file: CellFile, ref: string): void {
        const names = new Set<string>()
        for (const [index, example] of (file.examples ?? []).entries()) {
            const name = asText(example.name)
            const failed = (): CellsError =>
                new CellsError({
                    code: CellsErrorCode.ExampleFailed,
                    params: { ref, example: typeof example.name === "string" ? name : `#${String(index)}` },
                })
            const verdicts = ["ok", "ending", "refused"].filter((member) => Reflect.has(Object(example.expect), member))
            if (
                typeof example.name !== "string" ||
                example.name === "" ||
                names.has(name) ||
                example.input === undefined ||
                verdicts.length !== 1
            )
                throw failed()
            names.add(name)
            const refused = Reflect.get(Object(example.expect), "refused")
            if (refused !== undefined && !(file.semantics.refusals ?? []).includes(asText(refused)))
                throw new CellsError({ code: CellsErrorCode.RefusalUndeclared, params: { ref, code: asText(refused) } })
            const strayTool = (example.tools ?? []).find((tool) => !(file.semantics.tools ?? []).includes(tool.id))
            if (strayTool !== undefined)
                throw new CellsError({ code: CellsErrorCode.ToolUndeclared, params: { ref, tool: strayTool.id } })
        }
    }

    /** Whether a tool cell of that key exists (in the package, else stored) and whether it writes; null when there is none. */
    private async toolFactOf(key: string, accepted: AcceptedCells): Promise<{ readonly mutates: boolean } | null> {
        const own = [...accepted.values()]
            .filter((file) => file.kind === "tool" && file.key === key)
            .sort((a, b) => b.version - a.version)[0]
        if (own !== undefined) return { mutates: own.semantics.mutates }
        if (this.reader === undefined) return null
        const stored = (await this.reader.listed({ kind: "tool", enterprise: null }))
            .filter((ref) => ref.key === key)
            .sort((a, b) => b.version - a.version)[0]
        return stored === undefined ? null : { mutates: (await this.reader.definition(stored)).semantics.mutates }
    }

    /** What a graph step needs to know of the cell it names: the package's own, else the stored row; null when there is none. */
    private async factOf(ref: CellRef, accepted: AcceptedCells): Promise<GraphCellFact | null> {
        const own = accepted.get(cellRefText(ref))
        if (own !== undefined)
            return { kind: own.kind, retired: own.reviewState === "retired", outputSchema: own.output }
        if (this.reader === undefined) return null
        try {
            const stored = await this.reader.definition(ref)
            return {
                kind: stored.kind,
                retired: stored.reviewState === "retired" || stored.deleted,
                outputSchema: stored.outputSchema,
            }
        } catch (cause: unknown) {
            if (cause instanceof CellsError && cause.code === CellsErrorCode.Unknown) return null
            throw cause
        }
    }
}
