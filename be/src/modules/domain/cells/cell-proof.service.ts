import { Injectable } from "@nestjs/common"
import { canonicalJsonOf, refTextOf, sha256Of } from "./cell-hash.policy"
import { graphProblemOf } from "./cell-graph.policy"
import {
    PROOF_CASES,
    type CellProof,
    type CellProofWorld,
    type CellProofWorlds,
    type ProofCaseId,
    type ProofCaseResult,
    type ProofDoorCall,
} from "./cell-proof.contracts"
import { InjectCellProofWorlds } from "./cell-proof.decorators"
import { CellJsonSchemaPolicy } from "./cell-json-schema.policy"
import { sampleOf, violationsOf } from "./cell-proof.schema.policy"
import { REFUSAL_CLASS_FACT } from "./cell-executor.service"
import type { CellReader } from "./cell-reader.port"
import { writesOutside } from "./cell-verdict.policy"
import { InjectCellReader } from "./cells.decorators"
import type {
    CellDefinitionView,
    CellExample,
    CellGraphFile,
    CellOutcome,
    CellRef,
    CellSemantics,
    ExecuteRequest,
    ExecuteResult,
    ExecuteScope,
    JsonValue,
    RunFacts,
    StoredExpr,
    ToolAnswer,
} from "./cells.contracts"
import { CellsError, CellsErrorCode } from "./errors/cells.error"

/** The scope every case runs in: one workspace, one run, one step. */
const SCOPE: ExecuteScope = {
    workspaceId: "ws-proof",
    runId: "run-proof",
    stepKey: "step-proof",
    attempt: 1,
    enterprise: null,
    world: "live",
}
/** The recorded clock and random every case gives the run, so two runs of one source are comparable. */
const FACTS: RunFacts = { now: "2026-01-02T03:04:05.000Z", randomSeed: "kit-seed" }
/** A tool no cell declares. */
const UNDECLARED_TOOL = "kit.undeclared.tool"
/** A refusal code no cell declares. */
const UNDECLARED_REFUSAL = "kit_undeclared_refusal"
/** The usage a metered scripted answer reports. */
const USAGE = { units: 7, unit: "token" } as const

/** What an execution did: its result, or the typed error it threw. */
type Attempt =
    | { readonly kind: "result"; readonly result: ExecuteResult }
    | { readonly kind: "error"; readonly code: string; readonly message: string }

/** One example run in a fresh world. */
interface ExampleRun {
    readonly example: CellExample
    readonly attempt: Attempt
    readonly doorCalls: ReadonlyArray<ProofDoorCall>
}

const pass = (id: ProofCaseId, detail: string): ProofCaseResult => ({ id, status: "pass", detail })
const fail = (id: ProofCaseId, detail: string): ProofCaseResult => ({ id, status: "fail", detail })
const na = (id: ProofCaseId, detail: string): ProofCaseResult => ({ id, status: "na", detail })

/** The failures of a list of checks, joined; pass when there are none. */
const verdictOf = (id: ProofCaseId, passed: string, failures: ReadonlyArray<string>): ProofCaseResult =>
    failures.length === 0 ? pass(id, passed) : fail(id, failures.join("; "))

const refusal = (code: string, facts?: { readonly [member: string]: JsonValue }): ToolAnswer =>
    facts === undefined ? { ok: false, refusal: code } : { ok: false, refusal: code, facts }

const sameJson = (left: unknown, right: unknown): boolean => canonicalJsonOf(left) === canonicalJsonOf(right)

const isOutcome = <Kind extends CellOutcome["kind"]>(
    outcome: CellOutcome,
    kind: Kind,
): outcome is Extract<CellOutcome, { kind: Kind }> => outcome.kind === kind

/** `kind:key@version` of a row. */
const refOf = (row: CellRef): CellRef => ({ kind: row.kind, key: row.key, version: row.version })

const isControl = (row: CellDefinitionView): boolean => row.kind.startsWith("core.")

/** A cell the tool door serves: no stored source, a tool or an operation. */
const isServed = (row: CellDefinitionView): boolean =>
    row.sourceSha256 === null && (row.kind === "tool" || row.kind === "operation")

/** The expression table of `core.if`: an expression and the truth the plan's interpreter gives it (CELLS-PLAN 1.6: ordering only on numbers and ISO instants, `unknown` takes the `no` branch). */
const STATE = { trigger: { n: 5, s: "Hello", t: "2026-01-02T03:04:05Z", empty: "" }, steps: {}, vars: {}, item: null }
const at = (path: string): { readonly $ref: string } => ({ $ref: path })
const TRUTH_TABLE: ReadonlyArray<readonly [string, StoredExpr, true | false | "unknown"]> = [
    ["present of a value", { op: "present", ref: at("trigger.n") }, true],
    ["present of a missing ref", { op: "present", ref: at("trigger.missing") }, false],
    ["present of an empty text", { op: "present", ref: at("trigger.empty") }, false],
    ["absent of a missing ref", { op: "absent", ref: at("trigger.missing") }, true],
    ["absent of a value", { op: "absent", ref: at("trigger.n") }, false],
    ["eq equal", { op: "eq", ref: at("trigger.n"), value: 5 }, true],
    ["eq different", { op: "eq", ref: at("trigger.n"), value: 6 }, false],
    ["ne different", { op: "ne", ref: at("trigger.n"), value: 6 }, true],
    ["gt true", { op: "gt", ref: at("trigger.n"), value: 4 }, true],
    ["gt equal", { op: "gt", ref: at("trigger.n"), value: 5 }, false],
    ["gte equal", { op: "gte", ref: at("trigger.n"), value: 5 }, true],
    ["lt true", { op: "lt", ref: at("trigger.n"), value: 6 }, true],
    ["lt equal", { op: "lt", ref: at("trigger.n"), value: 5 }, false],
    ["lte equal", { op: "lte", ref: at("trigger.n"), value: 5 }, true],
    ["gt of a text against a number is unknown", { op: "gt", ref: at("trigger.s"), value: 1 }, "unknown"],
    ["gt of a missing ref is unknown", { op: "gt", ref: at("trigger.missing"), value: 1 }, "unknown"],
    ["lt of two ISO instants", { op: "lt", ref: at("trigger.t"), value: "2026-01-03T00:00:00Z" }, true],
    ["contains a part", { op: "contains", ref: at("trigger.s"), value: "Hell" }, true],
    ["contains is case-exact", { op: "contains", ref: at("trigger.s"), value: "hell" }, false],
    ["contains with caseFold", { op: "contains", ref: at("trigger.s"), value: "hell", caseFold: true }, true],
    ["contains of a number is unknown", { op: "contains", ref: at("trigger.n"), value: "x" }, "unknown"],
    [
        "and of true and unknown",
        {
            and: [
                { op: "present", ref: at("trigger.n") },
                { op: "gt", ref: at("trigger.s"), value: 1 },
            ],
        },
        "unknown",
    ],
    [
        "and of false and unknown",
        {
            and: [
                { op: "present", ref: at("trigger.missing") },
                { op: "gt", ref: at("trigger.s"), value: 1 },
            ],
        },
        false,
    ],
    [
        "or of true and unknown",
        {
            or: [
                { op: "present", ref: at("trigger.n") },
                { op: "gt", ref: at("trigger.s"), value: 1 },
            ],
        },
        true,
    ],
    [
        "or of false and unknown",
        {
            or: [
                { op: "present", ref: at("trigger.missing") },
                { op: "gt", ref: at("trigger.s"), value: 1 },
            ],
        },
        "unknown",
    ],
    ["not of unknown", { not: { op: "gt", ref: at("trigger.s"), value: 1 } }, "unknown"],
    ["not of true", { not: { op: "present", ref: at("trigger.n") } }, false],
    [
        "and of true and true",
        {
            and: [
                { op: "present", ref: at("trigger.n") },
                { op: "eq", ref: at("trigger.n"), value: 5 },
            ],
        },
        true,
    ],
    [
        "or of false and false",
        {
            or: [
                { op: "present", ref: at("trigger.missing") },
                { op: "eq", ref: at("trigger.n"), value: 6 },
            ],
        },
        false,
    ],
]

const deepNot = (depth: number, inner: StoredExpr): StoredExpr =>
    depth === 0 ? inner : { not: deepNot(depth - 1, inner) }

@Injectable()
/**
 * The generic test kit (CELLS-PLAN 7.4, "test = generic logic"): given ONE cell row, it proves the cell by what the row declares and by nothing
 * else. It drives the executor in a fresh world per case, scripts the tool door from the row's own tools and schemas, and judges the answer
 * against the table the plan states (not against the classifier it runs under). Nobody writes these cases per cell.
 */
export class CellProofService {
    constructor(
        @InjectCellProofWorlds() private readonly worlds: CellProofWorlds,
        @InjectCellReader() private readonly reader: CellReader,
        private readonly schemas: CellJsonSchemaPolicy,
    ) {}

    /** Proves the cell a ref names. */
    async prove(ref: CellRef): Promise<CellProof> {
        return this.proveRow(await this.reader.definition(ref))
    }

    /** Proves one row: every case, in order; a case the row gives nothing to judge is `na` with its reason, and a case that throws unexpectedly fails. */
    async proveRow(row: CellDefinitionView): Promise<CellProof> {
        const cases: Array<ProofCaseResult> = []
        for (const id of PROOF_CASES) {
            try {
                cases.push(await this.caseOf(id, row))
            } catch (cause: unknown) {
                cases.push(fail(id, `the case threw: ${cause instanceof Error ? cause.message : String(cause)}`))
            }
        }
        return { cell: refTextOf(row), ok: cases.every((result) => result.status !== "fail"), cases }
    }

    private caseOf(id: ProofCaseId, row: CellDefinitionView): Promise<ProofCaseResult> {
        switch (id) {
            case "examples":
                return this.examples(row)
            case "valid-input":
                return this.validInput(row)
            case "invalid-input":
                return this.invalidInput(row)
            case "output-shape":
                return this.outputShape(row)
            case "refusal-classes":
                return this.refusalClasses(row)
            case "refusal-final":
                return this.refusalFinal(row)
            case "refusal-undeclared":
                return this.refusalUndeclared(row)
            case "transient":
                return this.transient(row)
            case "unknown-outcome":
                return this.unknownOutcome(row)
            case "intent-once":
                return this.intentOnce(row)
            case "repeatable":
                return this.repeatable(row)
            case "declared-tools":
                return this.declaredTools(row)
            case "undeclared-tool":
                return this.undeclaredTool(row)
            case "limits":
                return this.limits(row)
            case "determinism":
                return this.determinism(row)
            case "metered":
                return this.metered(row)
            case "if-truth-table":
                return this.ifTruthTable(row)
            case "set-update":
                return this.setUpdate(row)
            case "set-undeclared":
                return Promise.resolve(this.setUndeclared(row))
            case "config-checks":
                return this.configChecks(row)
        }
    }

    // ---- plumbing -------------------------------------------------------------------------------------------------------------

    /** The source text of a row, or null when it has none. */
    private async sourceTextOf(row: CellDefinitionView): Promise<string | null> {
        return row.sourceSha256 === null ? null : (await this.reader.source(row.sourceSha256)).text
    }

    /** A fresh world holding the row (and its source), plus the probe rows a case adds. */
    private async worldOf(
        row: CellDefinitionView,
        probes: ReadonlyArray<{ readonly row: CellDefinitionView; readonly text: string }> = [],
        funded = true,
    ): Promise<CellProofWorld> {
        const world = this.worlds.open()
        if (funded && row.semantics.metered !== undefined) world.fund(1000)
        const own = await this.sourceTextOf(row)
        world.install(
            [row, ...probes.map((probe) => probe.row)],
            [...(own === null ? [] : [own]), ...probes.map((probe) => probe.text)],
        )
        return world
    }

    private requestOf(row: CellRef, input: JsonValue, config?: JsonValue): ExecuteRequest {
        return { scope: SCOPE, cell: refOf(row), input, ...(config === undefined ? {} : { config }), facts: FACTS }
    }

    private async attempt(world: CellProofWorld, request: ExecuteRequest): Promise<Attempt> {
        try {
            return { kind: "result", result: await world.executor.execute(request) }
        } catch (cause: unknown) {
            if (cause instanceof CellsError)
                return { kind: "error", code: cause.code, message: JSON.stringify(cause.params) }
            return { kind: "error", code: "thrown", message: cause instanceof Error ? cause.message : String(cause) }
        }
    }

    /** A valid input: the first example's, else a value the input schema accepts. */
    private validInputOf(row: CellDefinitionView): JsonValue {
        return row.examples[0]?.input ?? sampleOf(row.inputSchema)
    }

    /** A probe row: a stored source of the same kind, run in place of the row's own, holding only what a case needs of its semantics. */
    private probeOf(
        row: CellDefinitionView,
        name: string,
        text: string,
        over: { readonly semantics?: CellSemantics; readonly outputSchema?: CellDefinitionView["outputSchema"] } = {},
    ) {
        const probe: CellDefinitionView = {
            ...row,
            key: `kit.probe.${name}`,
            version: 1,
            inputSchema: {},
            outputSchema: over.outputSchema ?? {},
            semantics: over.semantics ?? { mutates: false },
            sourceSha256: sha256Of(text),
            examples: [],
            definitionHash: `kit-${name}`,
        }
        return { row: probe, text }
    }

    /** The source text of a probe, by entry: a trigger defines `translate`, every other source kind `run`. */
    private entrySource(row: CellDefinitionView, body: string): string {
        return row.kind === "trigger"
            ? `function translate(raw) { ${body} }\n`
            : `function run(input, ctx) { ${body} }\n`
    }

    private outcomeOf(attempt: Attempt): CellOutcome | null {
        return attempt.kind === "result" ? attempt.result.outcome : null
    }

    private describe(attempt: Attempt): string {
        return attempt.kind === "error"
            ? `threw ${attempt.code} ${attempt.message}`
            : `${attempt.result.outcome.kind} / ${attempt.result.verdict.kind} ${JSON.stringify(attempt.result.outcome)}`
    }

    // ---- the examples ---------------------------------------------------------------------------------------------------------

    /** What each tool of an example answers, in the order the example lists; a call beyond the list, or with other arguments, is refused. */
    private scriptOf(
        row: CellDefinitionView,
        example: CellExample,
    ): Readonly<Record<string, (args: JsonValue, nth: number) => ToolAnswer>> {
        const listed = example.tools ?? []
        if (listed.length === 0 && isServed(row)) {
            const answer: ToolAnswer =
                "ok" in example.expect
                    ? { ok: true, value: example.expect.ok }
                    : refusal("refused" in example.expect ? example.expect.refused : "kit_ending")
            return { [row.key]: () => answer }
        }
        const scripted: Record<string, (args: JsonValue, nth: number) => ToolAnswer> = {}
        for (const id of new Set(listed.map((entry) => entry.id))) {
            const entries = listed.filter((entry) => entry.id === id)
            scripted[id] = (args, nth) => {
                const entry = entries[nth]
                if (entry === undefined) return refusal("tool_unscripted")
                if (entry.args !== undefined && !sameJson(entry.args, args)) return refusal("tool_args_mismatch")
                return entry.answer
            }
        }
        return scripted
    }

    private async runExamples(row: CellDefinitionView): Promise<ReadonlyArray<ExampleRun>> {
        const runs: Array<ExampleRun> = []
        for (const example of row.examples) {
            const world = await this.worldOf(row)
            world.script(this.scriptOf(row, example))
            const attempt = await this.attempt(world, this.requestOf(row, example.input, example.config))
            runs.push({ example, attempt, doorCalls: world.observed().doorCalls })
        }
        return runs
    }

    private async examples(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (row.examples.length === 0) return na("examples", "the row declares no example")
        const failures: Array<string> = []
        for (const { example, attempt } of await this.runExamples(row)) {
            const outcome = this.outcomeOf(attempt)
            const expected = example.expect
            const holds =
                outcome !== null &&
                (("ok" in expected && isOutcome(outcome, "ok") && sameJson(outcome.output, expected.ok)) ||
                    ("ending" in expected && isOutcome(outcome, "ending") && outcome.reason === expected.ending) ||
                    ("refused" in expected &&
                        (isOutcome(outcome, "refused") || isOutcome(outcome, "refused-final")) &&
                        outcome.code === expected.refused))
            if (!holds)
                failures.push(
                    `example "${example.name}" expected ${JSON.stringify(expected)} but ${this.describe(attempt)}`,
                )
        }
        return verdictOf("examples", `${String(row.examples.length)} example(s) give their expected outcome`, failures)
    }

    private async declaredTools(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (row.sourceSha256 === null || row.examples.length === 0)
            return na("declared-tools", "no stored source with examples")
        const declared = row.semantics.tools ?? []
        const failures: Array<string> = []
        for (const { example, attempt, doorCalls } of await this.runExamples(row)) {
            const reached = new Set(doorCalls.map((call) => call.tool))
            if (attempt.kind === "result") for (const call of attempt.result.calls) reached.add(call.tool)
            for (const tool of reached)
                if (!declared.includes(tool)) failures.push(`example "${example.name}" calls undeclared tool ${tool}`)
            const outcome = this.outcomeOf(attempt)
            if (
                outcome !== null &&
                isOutcome(outcome, "failed") &&
                outcome.cause?.code === CellsErrorCode.ToolUndeclared
            ) {
                failures.push(`example "${example.name}" calls undeclared tool ${outcome.cause.detail ?? "?"}`)
            }
        }
        return verdictOf(
            "declared-tools",
            `every tool an example reaches is declared (${declared.join(", ") || "none"})`,
            failures,
        )
    }

    // ---- input, output --------------------------------------------------------------------------------------------------------

    private async validInput(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (!isServed(row)) return na("valid-input", "a stored source or control cell: judged by its examples")
        const input = this.validInputOf(row)
        const output = sampleOf(row.outputSchema)
        const world = await this.worldOf(row)
        world.script({ [row.key]: { ok: true, value: output } })
        const attempt = await this.attempt(world, this.requestOf(row, input))
        const outcome = this.outcomeOf(attempt)
        const holds =
            outcome !== null &&
            isOutcome(outcome, "ok") &&
            sameJson(outcome.output, output) &&
            attempt.kind === "result" &&
            attempt.result.verdict.kind === "continue"
        return holds
            ? pass("valid-input", "a valid input is accepted and the output keeps its shape")
            : fail("valid-input", `expected ok / continue but ${this.describe(attempt)}`)
    }

    private async invalidInput(row: CellDefinitionView): Promise<ProofCaseResult> {
        const variants = violationsOf(row.inputSchema)
        if (variants.length === 0) return na("invalid-input", "the input schema cannot be broken")
        const failures: Array<string> = []
        for (const variant of variants) {
            const world = await this.worldOf(row)
            const attempt = await this.attempt(
                world,
                this.requestOf(row, variant, isControl(row) ? sampleOf(row.configSchema) : undefined),
            )
            const seen = world.observed()
            if (attempt.kind !== "error" || attempt.code !== CellsErrorCode.InputInvalid)
                failures.push(`${JSON.stringify(variant)} was not refused: ${this.describe(attempt)}`)
            else if (seen.doorCalls.length > 0 || seen.sourceRuns > 0)
                failures.push(`${JSON.stringify(variant)} was refused after something ran`)
        }
        return verdictOf(
            "invalid-input",
            `${String(variants.length)} invalid input(s) refused CELLS_INPUT_INVALID before anything ran`,
            failures,
        )
    }

    private async outputShape(row: CellDefinitionView): Promise<ProofCaseResult> {
        const variants = violationsOf(row.outputSchema)
        if (variants.length === 0) return na("output-shape", "the output schema cannot be broken")
        if (isControl(row) || row.kind === "provider")
            return na("output-shape", "a control or provider cell has no output of its own to break")
        const failures: Array<string> = []
        const outside = writesOutside(row.semantics)
        for (const variant of variants) {
            const attempt = await this.runBad(row, variant)
            const outcome = this.outcomeOf(attempt)
            const holds = outside
                ? outcome !== null && isOutcome(outcome, "unknown")
                : outcome !== null &&
                  isOutcome(outcome, "failed") &&
                  outcome.why === "permanent" &&
                  outcome.cause?.code === CellsErrorCode.OutputInvalid
            if (!holds)
                failures.push(
                    `${JSON.stringify(variant)} expected ${outside ? "unknown" : "failed / CELLS_OUTPUT_INVALID"} but ${this.describe(attempt)}`,
                )
        }
        return verdictOf(
            "output-shape",
            `an output outside the schema is ${outside ? "unknown (an outside write)" : "failed"}`,
            failures,
        )
    }

    /** Runs the row so that it answers `value`: the tool door answers it, or a probe source returns it. */
    private async runBad(row: CellDefinitionView, value: JsonValue): Promise<Attempt> {
        if (isServed(row)) {
            const world = await this.worldOf(row)
            world.script({ [row.key]: { ok: true, value } })
            return this.attempt(world, this.requestOf(row, this.validInputOf(row)))
        }
        const probe = this.probeOf(row, "badoutput", this.entrySource(row, `return ${JSON.stringify(value)};`), {
            semantics: {
                mutates: row.semantics.mutates,
                ...(row.semantics.outside === undefined ? {} : { outside: row.semantics.outside }),
            },
            outputSchema: row.outputSchema,
        })
        const world = await this.worldOf(row, [probe])
        return this.attempt(world, this.requestOf(probe.row, {}))
    }

    // ---- refusals -------------------------------------------------------------------------------------------------------------

    private async refusalClasses(row: CellDefinitionView): Promise<ProofCaseResult> {
        const finals = row.semantics.finalRefusals ?? []
        const codes = (row.semantics.refusals ?? []).filter((code) => !finals.includes(code))
        if (!isServed(row) || codes.length === 0)
            return na("refusal-classes", "no non-final refusal declared on a served cell")
        const outside = writesOutside(row.semantics)
        const failures: Array<string> = []
        for (const code of codes) {
            const attempt = await this.refuse(row, code)
            const outcome = this.outcomeOf(attempt)
            const verdict = attempt.kind === "result" ? attempt.result.verdict : null
            const holds =
                outcome !== null &&
                isOutcome(outcome, "refused") &&
                outcome.code === code &&
                verdict !== null &&
                (outside ? verdict.kind === "stop" && verdict.why === "act_refused" : verdict.kind === "continue")
            if (!holds)
                failures.push(
                    `${code} expected refused / ${outside ? "stop act_refused" : "continue"} but ${this.describe(attempt)}`,
                )
        }
        return verdictOf(
            "refusal-classes",
            `each declared refusal is classified (${outside ? "an outside write stops" : "a read or inside write continues"})`,
            failures,
        )
    }

    private async refusalFinal(row: CellDefinitionView): Promise<ProofCaseResult> {
        const finals = row.semantics.finalRefusals ?? []
        if (!isServed(row) || finals.length === 0)
            return na("refusal-final", "no final refusal declared on a served cell")
        const failures: Array<string> = []
        for (const code of finals) {
            const attempt = await this.refuse(row, code)
            const outcome = this.outcomeOf(attempt)
            const verdict = attempt.kind === "result" ? attempt.result.verdict : null
            const holds =
                outcome !== null &&
                isOutcome(outcome, "refused-final") &&
                outcome.code === code &&
                verdict !== null &&
                verdict.kind === "unsuccessful" &&
                verdict.reason === code
            if (!holds) failures.push(`${code} expected refused-final / unsuccessful but ${this.describe(attempt)}`)
        }
        return verdictOf("refusal-final", "a final refusal is the business ending (unsuccessful)", failures)
    }

    private async refusalUndeclared(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (!isServed(row)) return na("refusal-undeclared", "no served cell")
        const attempt = await this.refuse(row, UNDECLARED_REFUSAL)
        const outcome = this.outcomeOf(attempt)
        const verdict = attempt.kind === "result" ? attempt.result.verdict : null
        const holds =
            outcome !== null &&
            isOutcome(outcome, "failed") &&
            outcome.cause?.code === CellsErrorCode.RefusalUndeclared &&
            verdict !== null &&
            verdict.kind === "stop" &&
            verdict.why === "failed"
        return holds
            ? pass("refusal-undeclared", "an undeclared refusal code is CELLS_REFUSAL_UNDECLARED, a failed stop")
            : fail("refusal-undeclared", `expected failed / stop failed but ${this.describe(attempt)}`)
    }

    private async refuse(row: CellDefinitionView, code: string): Promise<Attempt> {
        const world = await this.worldOf(row)
        world.script({ [row.key]: refusal(code) })
        return this.attempt(world, this.requestOf(row, this.validInputOf(row)))
    }

    // ---- transient, unknown, once, repeat --------------------------------------------------------------------------------------

    private async transient(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (!isServed(row)) return na("transient", "no served cell")
        const world = await this.worldOf(row)
        world.script({ [row.key]: refusal("kit_transient", { [REFUSAL_CLASS_FACT]: "transient" }) })
        const request = this.requestOf(row, this.validInputOf(row))
        const first = await this.attempt(world, request)
        const second = await this.attempt(world, request)
        const failures: Array<string> = []
        for (const attempt of [first, second]) {
            const outcome = this.outcomeOf(attempt)
            if (
                outcome === null ||
                !isOutcome(outcome, "transient") ||
                attempt.kind !== "result" ||
                attempt.result.verdict.kind !== "retry"
            )
                failures.push(`expected transient / retry but ${this.describe(attempt)}`)
        }
        const acts = world.observed().doorCalls.filter((call) => call.tool === row.key).length
        if (acts !== 2) failures.push(`a retry acts again (2 calls) but the door took ${String(acts)}`)
        return verdictOf("transient", "a transient failure is retried, never repeated as a second act", failures)
    }

    private async unknownOutcome(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (!isServed(row)) return na("unknown-outcome", "no served cell")
        const { semantics } = row
        const world = await this.worldOf(row)
        world.script({ [row.key]: refusal("kit_unknown", { [REFUSAL_CLASS_FACT]: "unknown" }) })
        const request = this.requestOf(row, this.validInputOf(row))
        const first = await this.attempt(world, request)
        const outcome = this.outcomeOf(first)
        const verdict = first.kind === "result" ? first.result.verdict : null
        if (outcome === null || verdict === null || !isOutcome(outcome, "unknown"))
            return fail("unknown-outcome", `expected unknown but ${this.describe(first)}`)
        const failures: Array<string> = []
        if (!semantics.mutates) {
            if (verdict.kind !== "retry")
                failures.push(`a read has no act to settle: expected retry but ${verdict.kind}`)
            return verdictOf("unknown-outcome", "an unknown answer of a read is retried", failures)
        }
        const second = await this.attempt(world, request)
        const acts = world.observed().doorCalls.filter((call) => call.tool === row.key)
        if (semantics.repeatable === true) {
            if (verdict.kind !== "repeat" || verdict.key !== outcome.key)
                failures.push(`repeatable: expected repeat with the intent key but ${JSON.stringify(verdict)}`)
            if (acts.length !== 2 || acts[0]?.key !== acts[1]?.key || acts[0]?.key !== outcome.key)
                failures.push("repeatable: the repeat must reach the door with the SAME key")
        } else {
            if (semantics.confirmBy !== undefined) {
                const read = { tool: semantics.confirmBy.tool, args: semantics.confirmBy.args }
                if (verdict.kind !== "confirm" || !sameJson(verdict.read, read))
                    failures.push(
                        `confirmBy: expected confirm with ${JSON.stringify(read)} but ${JSON.stringify(verdict)}`,
                    )
            } else if (
                verdict.kind !== "stop" ||
                verdict.why !== "outcome_unknown" ||
                verdict.retry !== "after_take_over"
            ) {
                failures.push(
                    `neither repeatable nor confirmBy: expected stop outcome_unknown after_take_over but ${JSON.stringify(verdict)}`,
                )
            }
            if (acts.length !== 1)
                failures.push(
                    `a non-repeatable write with an unknown outcome must not act again (1 call) but the door took ${String(acts.length)}`,
                )
            const again = this.outcomeOf(second)
            if (again === null || !isOutcome(again, "unknown"))
                failures.push(`the second execution must stay unknown but ${this.describe(second)}`)
        }
        return verdictOf(
            "unknown-outcome",
            semantics.repeatable === true
                ? "unknown outcome: repeat with the same key"
                : semantics.confirmBy === undefined
                  ? "unknown outcome: stop for a person"
                  : "unknown outcome: confirm by the declared read",
            failures,
        )
    }

    private async intentOnce(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (!row.semantics.mutates || isControl(row)) return na("intent-once", "the cell does not write")
        const world = await this.worldOf(row)
        let request: ExecuteRequest
        if (isServed(row)) {
            world.script({ [row.key]: { ok: true, value: sampleOf(row.outputSchema) } })
            request = this.requestOf(row, this.validInputOf(row))
        } else {
            const [example] = row.examples
            if (example === undefined) return na("intent-once", "a stored source with no example to run")
            world.script(this.scriptOf(row, example))
            request = this.requestOf(row, example.input, example.config)
        }
        const first = await this.attempt(world, request)
        const second = await this.attempt(world, request)
        const seen = world.observed()
        const acts = isServed(row) ? seen.doorCalls.filter((call) => call.tool === row.key).length : seen.sourceRuns
        const failures: Array<string> = []
        const left = this.outcomeOf(first)
        const right = this.outcomeOf(second)
        if (left === null || !isOutcome(left, "ok"))
            failures.push(`the first execution must be ok but ${this.describe(first)}`)
        else if (right === null || !sameJson(left, right))
            failures.push(`the second execution must answer the kept result but ${this.describe(second)}`)
        if (acts !== 1) failures.push(`one act expected for two executions with the same key, found ${String(acts)}`)
        return verdictOf(
            "intent-once",
            "a second execution with the same key answers the kept result with ONE act",
            failures,
        )
    }

    private async repeatable(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (row.semantics.repeatable !== true || !row.semantics.mutates)
            return na("repeatable", "the cell does not declare a repeatable write")
        if (isServed(row))
            return pass("repeatable", "the repeat reaches the door with the same key (see unknown-outcome)")
        if (row.sourceSha256 === null || row.examples.length === 0)
            return na("repeatable", "a stored source with no example to run twice")
        const failures: Array<string> = []
        for (const example of row.examples) {
            const logs: Array<string> = []
            for (const _round of [1, 2]) {
                const world = await this.worldOf(row)
                world.script(this.scriptOf(row, example))
                await this.attempt(world, this.requestOf(row, example.input, example.config))
                logs.push(canonicalJsonOf(world.observed().doorCalls))
            }
            if (logs[0] !== logs[1])
                failures.push(
                    `example "${example.name}" is declared repeatable but its two runs reach the door differently (not idempotent)`,
                )
        }
        return verdictOf(
            "repeatable",
            "a repeat of a repeatable cell reaches the door with the same calls and keys",
            failures,
        )
    }

    // ---- the runner: reach, limits, determinism --------------------------------------------------------------------------------

    private async undeclaredTool(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (row.sourceSha256 === null) return na("undeclared-tool", "no stored source")
        const probe = this.probeOf(
            row,
            "reach",
            this.entrySource(row, `tool(${JSON.stringify(UNDECLARED_TOOL)}, {}); return null;`),
            { semantics: { mutates: false, tools: row.semantics.tools ?? [] } },
        )
        const world = await this.worldOf(row, [probe])
        world.script({ [UNDECLARED_TOOL]: { ok: true, value: null } })
        const attempt = await this.attempt(world, this.requestOf(probe.row, {}))
        const outcome = this.outcomeOf(attempt)
        const reached = world.observed().doorCalls.some((call) => call.tool === UNDECLARED_TOOL)
        if (reached) return fail("undeclared-tool", "an undeclared tool reached the door")
        const holds =
            outcome !== null &&
            isOutcome(outcome, "failed") &&
            outcome.why === "permanent" &&
            (row.kind === "node" ? outcome.cause?.code === CellsErrorCode.ToolUndeclared : true)
        return holds
            ? pass(
                  "undeclared-tool",
                  row.kind === "node"
                      ? "a call of an undeclared tool is CELLS_TOOL_UNDECLARED and never reaches the door"
                      : "a source of this kind has no way out: the call fails and never reaches the door",
              )
            : fail("undeclared-tool", `expected failed / permanent but ${this.describe(attempt)}`)
    }

    private async limits(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (row.sourceSha256 === null) return na("limits", "no stored source")
        const failures: Array<string> = []
        const bodies: ReadonlyArray<readonly [string, string]> = [
            ["an endless loop", "while (true) {}"],
            [
                "an allocation past the memory limit",
                "const held = []; while (true) held.push(new Array(1000000).fill(1));",
            ],
        ]
        for (const [index, [name, body]] of bodies.entries()) {
            const probe = this.probeOf(row, `limits${String(index)}`, this.entrySource(row, body))
            const world = await this.worldOf(row, [probe])
            const attempt = await this.attempt(world, this.requestOf(probe.row, {}))
            const outcome = this.outcomeOf(attempt)
            if (outcome === null || !isOutcome(outcome, "failed") || outcome.why !== "limits")
                failures.push(`${name} expected failed / limits but ${this.describe(attempt)}`)
        }
        return verdictOf("limits", "an endless loop and a runaway allocation end failed / limits", failures)
    }

    private async determinism(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (row.sourceSha256 === null) return na("determinism", "no stored source")
        const failures: Array<string> = []
        for (const example of row.examples) {
            const seen: Array<string> = []
            for (const _round of [1, 2]) {
                const world = await this.worldOf(row)
                world.script(this.scriptOf(row, example))
                const attempt = await this.attempt(world, this.requestOf(row, example.input, example.config))
                seen.push(
                    canonicalJsonOf({
                        outcome: this.outcomeOf(attempt),
                        calls: attempt.kind === "result" ? attempt.result.calls : null,
                        door: world.observed().doorCalls,
                    }),
                )
            }
            if (seen[0] !== seen[1])
                failures.push(`example "${example.name}": two runs with the same recorded answers differ`)
        }
        const probe = this.probeOf(
            row,
            "clock",
            this.entrySource(row, "return { t: Date.now(), d: new Date().toISOString(), r: Math.random() };"),
        )
        const results: Array<string> = []
        for (const _round of [1, 2]) {
            const world = await this.worldOf(row, [probe])
            const outcome = this.outcomeOf(await this.attempt(world, this.requestOf(probe.row, {})))
            results.push(outcome !== null && isOutcome(outcome, "ok") ? canonicalJsonOf(outcome.output) : "not-ok")
        }
        const expectedClock = Date.parse(FACTS.now)
        const [first] = results
        const parsed =
            first === undefined || first === "not-ok" ? null : (JSON.parse(first) as { t?: number; d?: string })
        if (results[0] !== results[1] || parsed === null)
            failures.push("the recorded clock and random must give the same answer on every run")
        else if (parsed.t !== expectedClock || parsed.d !== FACTS.now)
            failures.push(`Date.now and new Date() must be the recorded instant ${FACTS.now}`)
        return verdictOf(
            "determinism",
            "two runs with the same recorded answers make the same calls and the same output; the clock and random are the recorded ones",
            failures,
        )
    }

    // ---- metering --------------------------------------------------------------------------------------------------------------

    private async metered(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (row.semantics.metered === undefined) return na("metered", "the cell is not metered")
        if (!isServed(row)) return na("metered", "a metered stored source books through the tools it calls")
        const failures: Array<string> = []
        const input = this.validInputOf(row)
        const empty = await this.worldOf(row, [], false)
        empty.script({ [row.key]: { ok: true, value: sampleOf(row.outputSchema), usage: USAGE } })
        const stopped = await this.attempt(empty, this.requestOf(row, input))
        const stoppedOutcome = this.outcomeOf(stopped)
        const stoppedVerdict = stopped.kind === "result" ? stopped.result.verdict : null
        if (
            stoppedOutcome === null ||
            !isOutcome(stoppedOutcome, "failed") ||
            stoppedVerdict === null ||
            stoppedVerdict.kind !== "stop" ||
            stoppedVerdict.why !== "credits_exhausted"
        ) {
            failures.push(`an empty pool expected stop credits_exhausted but ${this.describe(stopped)}`)
        }
        if (empty.observed().doorCalls.length > 0) failures.push("an empty pool must stop before anything runs")
        const funded = await this.worldOf(row)
        funded.fund(1000)
        funded.script({ [row.key]: { ok: true, value: sampleOf(row.outputSchema), usage: USAGE } })
        const done = await this.attempt(funded, this.requestOf(row, input))
        const booked = funded.observed().bookings
        if (this.outcomeOf(done)?.kind !== "ok") failures.push(`a funded run expected ok but ${this.describe(done)}`)
        else if (booked.length !== 1 || booked[0]?.billed !== true || booked[0].units !== USAGE.units)
            failures.push(`a successful run books its usage once, billed: found ${JSON.stringify(booked)}`)
        const failed = await this.worldOf(row)
        failed.fund(1000)
        failed.script({ [row.key]: refusal(UNDECLARED_REFUSAL) })
        await this.attempt(failed, this.requestOf(row, input))
        const failedBookings = failed.observed().bookings
        if (failedBookings.length !== 1 || failedBookings[0]?.billed !== false)
            failures.push(`a failed try is booked and never billed: found ${JSON.stringify(failedBookings)}`)
        return verdictOf(
            "metered",
            "an empty pool stops before running; a success books its usage billed; a failed try is booked, never billed",
            failures,
        )
    }

    // ---- control cells ---------------------------------------------------------------------------------------------------------

    private async ifTruthTable(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (row.kind !== "core.if") return na("if-truth-table", "not a core.if cell")
        const failures: Array<string> = []
        for (const [name, when, truth] of TRUTH_TABLE) {
            const world = await this.worldOf(row)
            const attempt = await this.attempt(
                world,
                this.requestOf(row, STATE, { when, yes: "Y", no: "N" } as unknown as JsonValue),
            )
            const outcome = this.outcomeOf(attempt)
            const expected = { truth, branch: truth === true ? "yes" : "no", next: truth === true ? "Y" : "N" }
            if (outcome === null || !isOutcome(outcome, "ok") || !sameJson(outcome.output, expected))
                failures.push(`${name}: expected ${JSON.stringify(expected)} but ${this.describe(attempt)}`)
        }
        const without = await this.attempt(
            await this.worldOf(row),
            this.requestOf(row, STATE, {
                when: { op: "gt", ref: at("trigger.s"), value: 1 },
                yes: "Y",
            } as unknown as JsonValue),
        )
        const noBranch = this.outcomeOf(without)
        if (
            noBranch === null ||
            !isOutcome(noBranch, "ok") ||
            !sameJson(noBranch.output, { truth: "unknown", branch: "no", next: null })
        )
            failures.push(
                `unknown with no declared no-branch: expected branch no, next null but ${this.describe(without)}`,
            )
        const deep = await this.attempt(
            await this.worldOf(row),
            this.requestOf(row, STATE, {
                when: deepNot(5, { op: "present", ref: at("trigger.n") }),
                yes: "Y",
                no: "N",
            } as unknown as JsonValue),
        )
        const deepOutcome = this.outcomeOf(deep)
        if (deepOutcome === null || isOutcome(deepOutcome, "ok"))
            failures.push(`an expression deeper than 4 must not be evaluated: ${this.describe(deep)}`)
        return verdictOf(
            "if-truth-table",
            `${String(TRUTH_TABLE.length)} expressions give their truth; unknown takes the no branch; depth 5 is refused`,
            failures,
        )
    }

    private async setUpdate(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (row.kind !== "core.set") return na("set-update", "not a core.set cell")
        const state = { ...STATE, vars: { base: { value: 10, by: "step-0", at: "2026-01-01T00:00:00.000Z" } } }
        const set = { a: 7, b: at("trigger.n"), c: at("vars.base"), d: at("vars.a") }
        const attempt = await this.attempt(await this.worldOf(row), this.requestOf(row, state, { set }))
        const outcome = this.outcomeOf(attempt)
        if (outcome === null || !isOutcome(outcome, "ok"))
            return fail("set-update", `expected ok but ${this.describe(attempt)}`)
        const update = (outcome.output as { vars?: { [name: string]: { value: JsonValue; by: string; at: string } } })
            .vars
        const failures: Array<string> = []
        if (update === undefined || !sameJson(Object.keys(update).sort(), ["a", "b", "c", "d"]))
            failures.push(`the update names exactly the variables set: found ${JSON.stringify(update)}`)
        else {
            const values = { a: 7, b: 5, c: 10, d: null }
            for (const [name, value] of Object.entries(values)) {
                const entry = update[name]
                if (entry === undefined || !sameJson(entry.value, value))
                    failures.push(`${name} expected ${JSON.stringify(value)}, found ${JSON.stringify(entry?.value)}`)
                else if (entry.by !== SCOPE.stepKey || Number.isNaN(Date.parse(entry.at)))
                    failures.push(
                        `${name} must carry its writer (${SCOPE.stepKey}) and an instant: ${JSON.stringify(entry)}`,
                    )
            }
        }
        return verdictOf(
            "set-update",
            "core.set answers { name: { value, by, at } } for each name, each value computed against the state before the step",
            failures,
        )
    }

    /** A graph naming an undeclared variable in `core.set` is refused CELLS_VAR_UNDECLARED at seed time; declared, it is accepted (the executor does not know the graph). */
    private setUndeclared(row: CellDefinitionView): ProofCaseResult {
        if (row.kind !== "core.set") return na("set-undeclared", "not a core.set cell")
        const graphOf = (declared: boolean): CellGraphFile => ({
            key: "kit.set",
            version: 1,
            start: "only",
            triggers: [],
            vars: declared ? { kit_var: { schema: { type: "number" } } } : {},
            steps: { only: { kind: "core.set", config: { set: { kit_var: 1 } } } },
        })
        const facts = { cellOf: () => null, schemaProblemOf: (schema: unknown) => this.schemas.schemaProblemOf(schema) }
        const refused = graphProblemOf(graphOf(false), facts)
        const accepted = graphProblemOf(graphOf(true), facts)
        const failures: Array<string> = []
        if (refused === null || refused.code !== CellsErrorCode.VarUndeclared)
            failures.push(
                `an undeclared variable expected CELLS_VAR_UNDECLARED but ${refused === null ? "the graph was accepted" : refused.code}`,
            )
        if (accepted !== null) failures.push(`a declared variable must be accepted but ${accepted.code}`)
        return verdictOf(
            "set-undeclared",
            "core.set of an undeclared variable is refused CELLS_VAR_UNDECLARED, of a declared one accepted",
            failures,
        )
    }

    private async configChecks(row: CellDefinitionView): Promise<ProofCaseResult> {
        if (!isControl(row)) return na("config-checks", "not a control cell")
        const failures: Array<string> = []
        const world = await this.worldOf(row)
        const valid = await this.attempt(world, this.requestOf(row, STATE, sampleOf(row.configSchema)))
        if (valid.kind === "error" && valid.code === CellsErrorCode.InputInvalid)
            failures.push(`a config the schema accepts was refused: ${valid.message}`)
        const variants = violationsOf(row.configSchema)
        for (const variant of variants) {
            const attempt = await this.attempt(await this.worldOf(row), this.requestOf(row, STATE, variant))
            if (attempt.kind !== "error" || attempt.code !== CellsErrorCode.InputInvalid)
                failures.push(`${JSON.stringify(variant)} was not refused: ${this.describe(attempt)}`)
        }
        if (variants.length === 0 && failures.length === 0)
            return na("config-checks", "the config schema cannot be broken")
        return verdictOf(
            "config-checks",
            `a valid config is accepted, ${String(variants.length)} invalid one(s) refused CELLS_INPUT_INVALID`,
            failures,
        )
    }
}
