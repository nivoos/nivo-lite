import { Injectable } from "@nestjs/common"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { injector, type TypedParameterDecorator } from "@modules/platform/composition"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { CellExpressionPolicy, isStoredExpr, type ExpressionScope, type IfConfig } from "./cell-expression.policy"
import { canonicalJsonOf, refTextOf, sha256Of } from "./cell-hash.policy"
import type { CellExecutor } from "./cell-executor.port"
import { CellJsonSchemaPolicy } from "./cell-json-schema.policy"
import type { CellReader } from "./cell-reader.port"
import type { CellRunner, RunnerDoor } from "./cell-runner.port"
import type { CellLedger } from "./cell-ledger.port"
import type { CellMeter } from "./cell-meter.port"
import type { CellToolDoor } from "./cell-tool-door.port"
import { CREDITS_EXHAUSTED_CODE, isDeclaredRefusal, isFinalRefusal, verdictOf, writesOutside } from "./cell-verdict.policy"
import { InjectCellLedger, InjectCellMeter, InjectCellReader, InjectCellRunner, InjectCellToolDoor } from "./cells.decorators"
import type {
    CellDefinitionView,
    CellOutcome,
    CellRef,
    CoreSetConfig,
    ExecuteRequest,
    ExecuteResult,
    JsonObject,
    JsonValue,
    RecordedCall,
    RunFacts,
    RunnerFacts,
    RunnerLimits,
    RunnerRunResult,
    ToolAnswer,
    ToolUsage,
    UsageFigures,
} from "./cells.contracts"
import { CellsLogEvent } from "./cells.log-events"
import { CellsError, CellsErrorCode } from "./errors/cells.error"

/** Token of the default limits every source run is held to (the module binds `CellsOptions.runnerLimits`). */
export const CELLS_RUNNER_LIMITS: unique symbol = Symbol("domain.cells.runner-limits")

/** Injects the default runner limits. Parameter type: RunnerLimits. */
export const InjectCellsRunnerLimits = (): TypedParameterDecorator<RunnerLimits> => injector<RunnerLimits>(CELLS_RUNNER_LIMITS)

/** The member of a refusal's `facts` that marks its class when it is not a business refusal: `transient` or `unknown` (typed, never read from words). */
export const REFUSAL_CLASS_FACT = "class"

/** The cause codes the executor itself gives (besides the `CellsErrorCode` values). */
export const CELL_CAUSE = {
    /** A control kind phase 0 does not interpret (no V2 thread runtime). */
    controlNotInterpreted: "control_not_interpreted",
    /** A stored expression the interpreter does not accept. */
    expressionInvalid: "expression_invalid",
    /** A source threw. */
    sourceThrown: "source_thrown",
    /** A failure the executor could not class further. */
    thrown: "thrown",
} as const

/** How many recorded tool answers the executor keeps for a re-run; the oldest goes first. */
const RECORDED_LIMIT = 10_000

/** What one run of a cell produced, before the ledger and the meter see it. */
interface Ran {
    readonly outcome: CellOutcome
    readonly calls: ReadonlyArray<RecordedCall>
}

/** What one run of a cell produced and whether it ran now (a replayed intent did not). */
interface Booked extends Ran {
    readonly ranNow: boolean
}

/** Carries a run outcome out of the ledger's `act` when the key must not be settled (a retry or a repeat runs again; unknown keeps the key open). */
class UnsettledAct extends Error {
    /** The ledger reads this member: 1 keeps the intent open (outcome unknown), 0 releases it. */
    readonly outcomeUnknown: 0 | 1

    constructor(
        readonly ran: Ran,
        keepOpen: boolean,
    ) {
        super("unsettled")
        this.outcomeUnknown = keepOpen && ran.outcome.kind === "unknown" ? 1 : 0
    }
}

/** Whether a kind is a control kind the interpreter evaluates, not a work cell. */
const isControlKind = (kind: CellRef["kind"]): boolean => kind.startsWith("core.") || kind === "provider"

const failedOf = (why: "confused" | "permanent" | "limits", code: string, detail?: string): CellOutcome => ({
    kind: "failed",
    why,
    cause: detail === undefined ? { code } : { code, detail },
})

/** Keeps a value in a bounded map: the oldest entry goes first once the bound is reached. */
const keep = <Value>(into: Map<string, Value>, key: string, value: Value): void => {
    if (into.size >= RECORDED_LIMIT) {
        const oldest = into.keys().next()
        if (oldest.done !== true) into.delete(oldest.value)
    }
    into.set(key, value)
}

/** The usage figures of an envelope usage. */
const usageOf = (reported: ToolUsage): UsageFigures => ({ units: reported.units })

const isRecord = (value: unknown): value is { readonly [member: string]: JsonValue } =>
    typeof value === "object" && value !== null && !Array.isArray(value)

@Injectable()
/**
 * The one road for every cell kind (CELLS-PLAN 1.5): validate in, gate the meter, record the intent, run (a stored source through the
 * runner, a declarative cell through the tool door, a control cell through the expression interpreter), validate out, classify, book.
 * Rights are not here: the door decides whether a call may happen, the executor decides what happened.
 */
export class CellExecutorService implements CellExecutor {
    private readonly recorded = new Map<string, ToolAnswer>()
    private readonly recordedFacts = new Map<string, RunFacts>()

    constructor(
        @InjectCellReader() private readonly reader: CellReader,
        @InjectCellRunner() private readonly runner: CellRunner,
        @InjectCellLedger() private readonly ledger: CellLedger,
        @InjectCellMeter() private readonly meter: CellMeter,
        @InjectCellToolDoor() private readonly door: CellToolDoor,
        @InjectCellsRunnerLimits() private readonly limits: RunnerLimits,
        @InjectClock() private readonly clock: Clock,
        @InjectLogger() private readonly logger: Logger,
        private readonly expressions: CellExpressionPolicy,
        private readonly schemas: CellJsonSchemaPolicy,
    ) {}

    async execute(request: ExecuteRequest): Promise<ExecuteResult> {
        const definition = await this.reader.definition(request.cell)
        if (definition.reviewState === "draft") {
            throw new CellsError({ code: CellsErrorCode.Unknown, params: { ref: refTextOf(request.cell) } })
        }
        this.checkIn(definition, request)
        const ran = isControlKind(definition.kind) ? this.control(definition, request) : await this.work(definition, request)
        const verdict = verdictOf(definition.semantics, ran.outcome)
        this.logger.info(CellsLogEvent.Executed, {
            cell: refTextOf(request.cell),
            workspaceId: request.scope.workspaceId,
            runId: request.scope.runId,
            stepKey: request.scope.stepKey,
            outcome: ran.outcome.kind,
            verdict: verdict.kind,
        })
        return { outcome: ran.outcome, verdict, calls: ran.calls }
    }

    /** Stage 1: the input (and the config, when given) must fit the cell's schemas; nothing runs otherwise. */
    private checkIn(definition: CellDefinitionView, request: ExecuteRequest): void {
        const ref = refTextOf(request.cell)
        const path = this.schemas.problemOf(ref, definition.inputSchema, request.input)
        if (path !== null) throw new CellsError({ code: CellsErrorCode.InputInvalid, params: { ref, path } })
        if (request.config === undefined) return
        const configPath = this.schemas.problemOf(ref, definition.configSchema, request.config)
        if (configPath !== null) throw new CellsError({ code: CellsErrorCode.InputInvalid, params: { ref, path: `config${configPath}` } })
    }

    /** A control cell: data evaluated by the interpreter. Its input is the run memory, its config the cell settings of the step. */
    private control(definition: CellDefinitionView, request: ExecuteRequest): Ran {
        const scope = request.input as unknown as ExpressionScope
        if (definition.kind === "core.if") {
            const config = request.config
            if (!isRecord(config) || !isStoredExpr(config.when) || this.expressions.problemsOf(config.when).length > 0) {
                return { outcome: failedOf("permanent", CELL_CAUSE.expressionInvalid), calls: [] }
            }
            const decision = this.expressions.decide(config as unknown as IfConfig, scope)
            return { outcome: { kind: "ok", output: { truth: decision.truth, branch: decision.branch, next: decision.next } }, calls: [] }
        }
        if (definition.kind === "core.set") {
            if (!isRecord(request.config) || !isRecord(request.config.set)) {
                return { outcome: failedOf("permanent", CELL_CAUSE.expressionInvalid), calls: [] }
            }
            const update = this.expressions.setVariables(request.config as unknown as CoreSetConfig, scope, request.scope.stepKey, this.clock.now().toISOString())
            return { outcome: { kind: "ok", output: { vars: Object.fromEntries(Object.entries(update).map(([name, variable]) => [name, { value: variable.value, by: variable.by, at: variable.at }])) } }, calls: [] }
        }
        return { outcome: failedOf("permanent", CELL_CAUSE.controlNotInterpreted), calls: [] }
    }

    /** A work cell: stages 2 to 6. */
    private async work(definition: CellDefinitionView, request: ExecuteRequest): Promise<Ran> {
        const { semantics } = definition
        const metered = semantics.metered !== undefined && request.scope.world === "live"
        if (metered && !(await this.meter.allows(request.scope.workspaceId, request.cell, null))) {
            this.logger.warn(CellsLogEvent.CreditsExhausted, { cell: refTextOf(request.cell), workspaceId: request.scope.workspaceId })
            return { outcome: failedOf("limits", CREDITS_EXHAUSTED_CODE), calls: [] }
        }
        const key = this.intentKeyOf(request)
        const ran: Booked = semantics.mutates
            ? await this.once(definition, request, key)
            : { ...(await this.run(definition, request, key)), ranNow: true }
        if (metered && ran.ranNow) await this.book(definition, request, ran.outcome)
        return { outcome: ran.outcome, calls: ran.calls }
    }

    /** Stage 3: the intent is recorded BEFORE the act; a settled key answers its kept result without acting. */
    private async once(definition: CellDefinitionView, request: ExecuteRequest, key: string): Promise<Booked> {
        let ranNow = false
        const calls: Array<RecordedCall> = []
        try {
            const { replayed, outcome } = await this.ledger.once(key, async () => {
                ranNow = true
                const ran = await this.run(definition, request, key)
                calls.push(...ran.calls)
                if (ran.outcome.kind === "ok" || ran.outcome.kind === "ending" || ran.outcome.kind === "refused-final") return ran.outcome
                throw new UnsettledAct(ran, definition.semantics.repeatable !== true)
            })
            if (replayed) {
                this.logger.info(CellsLogEvent.Replayed, { cell: refTextOf(request.cell), runId: request.scope.runId, stepKey: request.scope.stepKey })
                return { outcome, calls: [], ranNow: false }
            }
            return { outcome, calls, ranNow }
        } catch (cause: unknown) {
            if (cause instanceof UnsettledAct) return { ...cause.ran, ranNow }
            throw cause
        }
    }

    /** Stage 4 and 5: run the cell, validate its output, classify what it answered. Never throws: a failure is an outcome. */
    private async run(definition: CellDefinitionView, request: ExecuteRequest, key: string): Promise<Ran> {
        const calls: Array<RecordedCall> = []
        let outcome: CellOutcome
        try {
            outcome =
                definition.sourceSha256 === null
                    ? await this.runDeclared(definition, request, key)
                    : await this.runSource(definition, request, key, definition.sourceSha256, calls)
        } catch (cause: unknown) {
            outcome = this.outcomeOfThrow(cause, key)
        }
        return { outcome: this.checkOut(definition, request.cell, outcome, key), calls }
    }

    /** A cell with no stored source is served by the tool door under its own key (the engine primitives and providers sit behind it). */
    private async runDeclared(definition: CellDefinitionView, request: ExecuteRequest, key: string): Promise<CellOutcome> {
        const answer = await this.door.call(request.scope, definition.key, request.input, { key })
        const outcome = this.outcomeOfAnswer(definition, answer, key)
        return outcome.kind === "ok" && answer.ok && answer.usage !== undefined ? { ...outcome, usage: usageOf(answer.usage) } : outcome
    }

    /** A cell with a stored source goes through the isolated runner; every call the source makes comes back through this door. */
    private async runSource(
        definition: CellDefinitionView,
        request: ExecuteRequest,
        key: string,
        sha256: string,
        calls: Array<RecordedCall>,
    ): Promise<CellOutcome> {
        const source = await this.reader.source(sha256)
        const ref = refTextOf(request.cell)
        const declared = definition.semantics.tools ?? []
        let undeclared: string | null = null
        const door: RunnerDoor = {
            call: async (call, tool, args) => {
                if (!declared.includes(tool)) {
                    undeclared = tool
                    this.logger.warn(CellsLogEvent.ToolUndeclared, { cell: ref, tool })
                    throw new CellsError({ code: CellsErrorCode.ToolUndeclared, params: { ref, tool } })
                }
                const answer = await this.recordedCall(request, key, call, tool, args)
                calls.push({ call, tool, args, answer })
                return answer
            },
            say: (_call, text) => Promise.resolve(text),
        }
        const recordedFacts = this.factsOf(request, key)
        const facts: RunnerFacts = {
            at: recordedFacts.now,
            day: recordedFacts.now.slice(0, 10),
            randomSeed: recordedFacts.randomSeed,
            item: null,
            queue: [],
            waiting: 0,
            workspace: { id: request.scope.workspaceId },
        }
        // The runner client reads two members beyond the slice-0 request: the tools the cell declared and its kind (CellRunRequest of S3).
        const run = {
            type: "run" as const,
            id: key,
            entry: definition.kind === "trigger" ? ("translate" as const) : ("run" as const),
            source: source.text,
            sha256: source.sha256,
            input: request.input,
            facts,
            limits: this.limitsOf(definition),
            declaredTools: declared,
            cellKind: definition.kind,
        }
        const result = await this.runner.run(run, door)
        if (undeclared !== null) return failedOf("permanent", CellsErrorCode.ToolUndeclared, undeclared)
        const outcome = this.outcomeOfRun(result)
        const used = calls.reduce((sum, made) => sum + (made.answer.usage?.units ?? 0), 0)
        return outcome.kind === "ok" && used > 0 ? { ...outcome, usage: { units: used } } : outcome
    }

    /** The clock and random of an intent: given by the request, else taken once and recorded, so a replay of the same intent sees the same ones. */
    private factsOf(request: ExecuteRequest, key: string): RunFacts {
        if (request.facts !== undefined) return request.facts
        const kept = this.recordedFacts.get(key)
        if (kept !== undefined) return kept
        const taken: RunFacts = { now: this.clock.now().toISOString(), randomSeed: key }
        keep(this.recordedFacts, key, taken)
        return taken
    }

    /** The limits of a run: the defaults, and a cell's own timeout may only go lower. */
    private limitsOf(definition: CellDefinitionView): RunnerLimits {
        const own = definition.semantics.timeoutMs
        return own === undefined ? this.limits : { ...this.limits, wallMs: Math.min(this.limits.wallMs, own) }
    }

    /** A tool call of a source: a settled answer recorded under this key is replayed on a re-run, never sent again. */
    private async recordedCall(request: ExecuteRequest, key: string, call: number, tool: string, args: JsonValue): Promise<ToolAnswer> {
        const id = `${key}:${String(call)}:${tool}:${canonicalJsonOf(args)}`
        const kept = this.recorded.get(id)
        if (kept !== undefined) return kept
        const answer = await this.door.call(request.scope, tool, args, { key: `${key}:${String(call)}` })
        const settled = answer.ok || answer.facts?.[REFUSAL_CLASS_FACT] === undefined
        if (settled) {
            keep(this.recorded, id, answer)
        }
        return answer
    }

    private outcomeOfRun(result: RunnerRunResult): CellOutcome {
        if (result.type === "done") return { kind: "ok", output: result.output }
        if (result.type === "ended") return { kind: "ending", reason: result.reason, why: result.why }
        if (result.why === "limits") return failedOf("limits", CellsErrorCode.RunnerLimits, result.detail)
        if (result.why === "output") return failedOf("permanent", CellsErrorCode.OutputInvalid, result.detail)
        if (result.why === "syntax") return failedOf("permanent", CellsErrorCode.SourceSyntax, result.detail)
        return failedOf("permanent", CELL_CAUSE.sourceThrown, result.detail)
    }

    /** What a tool door answer means for the cell: a value, a typed class (`transient`, `unknown`), or a refusal judged by the declarations. */
    private outcomeOfAnswer(definition: CellDefinitionView, answer: ToolAnswer, key: string): CellOutcome {
        if (answer.ok) return { kind: "ok", output: answer.value }
        const facts: JsonObject = answer.facts ?? {}
        const refusalClass = facts[REFUSAL_CLASS_FACT]
        if (refusalClass === "transient") return { kind: "transient", cause: { code: answer.refusal } }
        if (refusalClass === "unknown") return { kind: "unknown", key }
        const { semantics } = definition
        if (isFinalRefusal(semantics, answer.refusal)) return { kind: "refused-final", code: answer.refusal }
        if (isDeclaredRefusal(semantics, answer.refusal)) return { kind: "refused", code: answer.refusal, facts }
        return failedOf("permanent", CellsErrorCode.RefusalUndeclared, answer.refusal)
    }

    /** A thrown failure, class by typed members only: `CellsError` codes, `outcomeUnknown`, `transient`. */
    private outcomeOfThrow(cause: unknown, key: string): CellOutcome {
        if (cause instanceof CellsError) {
            if (cause.code === CellsErrorCode.RunnerLimits) return failedOf("limits", cause.code)
            if (cause.code === CellsErrorCode.RunnerCrashed) return { kind: "transient", cause: { code: cause.code } }
            const tool = cause.params.tool
            return typeof tool === "string" ? failedOf("permanent", cause.code, tool) : failedOf("permanent", cause.code)
        }
        if (Reflect.get(Object(cause), "outcomeUnknown") === 1) return { kind: "unknown", key }
        if (Reflect.get(Object(cause), "transient") === true) return { kind: "transient", cause: { code: CELL_CAUSE.thrown } }
        return failedOf("permanent", CELL_CAUSE.thrown)
    }

    /** Stage 5: an output outside the schema is `unknown` for a write outside NIVO (it happened, its answer cannot be read) and `failed` otherwise. */
    private checkOut(definition: CellDefinitionView, ref: CellRef, outcome: CellOutcome, key: string): CellOutcome {
        const unreadable = outcome.kind === "failed" && outcome.cause?.code === CellsErrorCode.OutputInvalid
        if (outcome.kind === "ok") {
            const path = this.schemas.problemOf(refTextOf(ref), definition.outputSchema, outcome.output)
            if (path === null) return outcome
            return writesOutside(definition.semantics) ? { kind: "unknown", key } : failedOf("permanent", CellsErrorCode.OutputInvalid, path)
        }
        return unreadable && writesOutside(definition.semantics) ? { kind: "unknown", key } : outcome
    }

    /** Stage 6: books the usage of a metered run. A failed try is booked and never billed. */
    private async book(definition: CellDefinitionView, request: ExecuteRequest, outcome: CellOutcome): Promise<void> {
        const billed = outcome.kind === "ok"
        const usage = outcome.kind === "ok" ? this.usageFor(definition, outcome) : { units: 0 }
        try {
            await this.meter.book(request.scope.workspaceId, request.cell, usage, billed)
        } catch (cause: unknown) {
            this.logger.error(CellsLogEvent.BookingFailed, cause, { cell: refTextOf(request.cell), workspaceId: request.scope.workspaceId })
        }
    }

    /** The usage of a metered run: what its answers reported in their envelopes, else one unit at the fixed price when the cell declares one. */
    private usageFor(definition: CellDefinitionView, outcome: Extract<CellOutcome, { kind: "ok" }>): UsageFigures {
        const metered = definition.semantics.metered
        if (outcome.usage !== undefined) return outcome.usage
        if (metered !== undefined && metered.price !== "reported") return { units: 1, usd: metered.price.usdPerUnit }
        return { units: 0 }
    }

    /** The key of an act: `<run>:<step>:<digest of the cell, input and config>` (V1's call digest). */
    private intentKeyOf(request: ExecuteRequest): string {
        const digest = sha256Of(canonicalJsonOf({ cell: request.cell, input: request.input, config: request.config ?? null }))
        return `${request.scope.runId}:${request.scope.stepKey}:${digest}`
    }
}
