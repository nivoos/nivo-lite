import { Injectable } from "@nestjs/common"
import type {
    CoreSetConfig,
    ExprTruth,
    JsonObject,
    JsonValue,
    RefOrValue,
    RunVariable,
    StoredExpr,
    StoredRef,
} from "./cells.contracts"
import { canonicalJsonOf } from "./cell-hash.policy"

/** The deepest nesting of `and` / `or` / `not` a stored expression may have (CELLS-PLAN 1.6). */
export const EXPRESSION_MAX_DEPTH = 4

/**
 * The run memory an expression reads: the regions of the LangGraph state of the thread (CELLS-DECISIONS D1). `previous` holds the steps
 * of the round before, for a ref with `round: "previous"` inside a loop.
 */
export interface ExpressionScope {
    readonly trigger: JsonValue
    readonly steps: Readonly<Record<string, { readonly output: JsonValue }>>
    readonly vars: Readonly<Record<string, RunVariable>>
    readonly item: JsonValue
    readonly previous?: Readonly<Record<string, { readonly output: JsonValue }>>
}

/** What `core.if` answers: the truth, the branch it takes and the step that follows (null when the `no` branch is not declared). */
export interface IfDecision {
    readonly truth: ExprTruth
    readonly branch: "yes" | "no"
    readonly next: string | null
}

/** The config of `core.if` as the policy reads it. */
export interface IfConfig {
    readonly when: StoredExpr
    readonly yes: string
    readonly no?: string
}

/** The limits of a literal bound (a loop's `max`, `concurrency`, ...). */
export interface BoundLimits {
    readonly min: number
    readonly max: number
}

/** The compare operators of the stored expression. */
type CompareOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains"

const COMPARE_OPERATORS: ReadonlyArray<string> = ["eq", "ne", "gt", "gte", "lt", "lte", "contains"]

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_TIME = /^\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

const isRecord = (value: unknown): value is { readonly [member: string]: JsonValue } =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/** Whether a value is a stored ref. */
export const isStoredRef = (value: unknown): value is StoredRef => isRecord(value) && typeof value.$ref === "string"

/** Whether a value is a stored expression (a leaf with a known operator and a ref, or `and` / `or` / `not`). */
export const isStoredExpr = (value: unknown): value is StoredExpr => {
    if (!isRecord(value)) return false
    if (Array.isArray(value.and) || Array.isArray(value.or)) return true
    if ("not" in value) return isRecord(value.not)
    return (value.op === "present" || value.op === "absent" || COMPARE_OPERATORS.includes(String(value.op))) && isStoredRef(value.ref)
}

const hasIsoShape = (text: string): boolean => {
    if (text.length === 10) return ISO_DATE.test(text)
    return text.charAt(10) === "T" && ISO_DATE.test(text.slice(0, 10)) && ISO_TIME.test(text.slice(11))
}

const isIsoInstant = (text: string): boolean => hasIsoShape(text) && !Number.isNaN(Date.parse(text))

/** The number an order compares by: itself, or the epoch milliseconds of an ISO instant; null for anything else. */
const orderOf = (value: JsonValue): number | null => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value !== "string" || !isIsoInstant(value)) return null
    return Date.parse(value)
}

const isSinglePoint = (text: string): boolean => [...text].length === 1

const foldedPoint = (point: string): string => {
    const upper = point.toUpperCase()
    if (isSinglePoint(upper)) {
        const lower = upper.toLowerCase()
        if (isSinglePoint(lower)) return lower
    }
    const lower = point.toLowerCase()
    return isSinglePoint(lower) ? lower : point
}

/** A text folded for a case-blind comparison: the default Unicode simple case mappings, locale free. */
const foldedOf = (text: string): string => [...text].map((point) => foldedPoint(point)).join("")

/** Whether a value is present: not null, not empty text, not an empty list. */
const isPresent = (value: JsonValue): boolean => value !== null && value !== "" && !(Array.isArray(value) && value.length === 0)

const compareTruth = (op: CompareOperator, left: JsonValue, right: JsonValue, caseFold: boolean): ExprTruth => {
    if (op === "eq") return canonicalJsonOf(left) === canonicalJsonOf(right)
    if (op === "ne") return canonicalJsonOf(left) !== canonicalJsonOf(right)
    if (op === "contains") {
        if (typeof left !== "string" || typeof right !== "string") return "unknown"
        return caseFold ? foldedOf(left).includes(foldedOf(right)) : left.includes(right)
    }
    const a = orderOf(left)
    const b = orderOf(right)
    if (a === null || b === null || typeof left !== typeof right) return "unknown"
    if (op === "lt") return a < b
    if (op === "lte") return a <= b
    if (op === "gt") return a > b
    return a >= b
}

const allOf = (truths: ReadonlyArray<ExprTruth>): ExprTruth => {
    if (truths.includes(false)) return false
    return truths.includes("unknown") ? "unknown" : true
}

const anyOf = (truths: ReadonlyArray<ExprTruth>): ExprTruth => {
    if (truths.includes(true)) return true
    return truths.includes("unknown") ? "unknown" : false
}

/** Walks a path of member names (or list indexes) into a value; undefined when a step is missing. */
const walk = (from: JsonValue | undefined, path: ReadonlyArray<string>): JsonValue | undefined => {
    let current = from
    for (const name of path) {
        if (Array.isArray(current)) {
            const index = Number(name)
            current = Number.isInteger(index) ? current[index] : undefined
        } else if (isRecord(current)) {
            current = current[name]
        } else {
            return undefined
        }
    }
    return current
}

@Injectable()
/**
 * The total, side-effect-free interpreter of stored expressions, refs, mappings and `core.if` / `core.set` (CELLS-PLAN 1.6, CELLS-DECISIONS D1).
 * It never calls `eval`, never throws on a value, and reads only the run memory it is given. Three-valued (Kleene): `unknown` takes the `no` branch.
 */
export class CellExpressionPolicy {
    /** The value a ref names in the run memory, or its `default` (null when none) when the path is absent. */
    resolveRef(ref: StoredRef, scope: ExpressionScope): JsonValue {
        const [region = "", ...rest] = ref.$ref.split(".")
        const steps = ref.round === "previous" ? (scope.previous ?? {}) : scope.steps
        let found: JsonValue | undefined
        if (region === "trigger") found = walk(scope.trigger, rest)
        if (region === "item") found = walk(scope.item, rest)
        if (region === "vars") {
            const [name = "", ...inside] = rest
            const variable = Object.hasOwn(scope.vars, name) ? scope.vars[name] : undefined
            found = variable === undefined ? undefined : walk(variable.value, inside)
        }
        if (region === "steps") {
            const [key = "", ...inside] = rest
            const step = Object.hasOwn(steps, key) ? steps[key] : undefined
            found = step === undefined ? undefined : inside[0] === "output" ? walk(step.output, inside.slice(1)) : undefined
        }
        return found ?? ref.default ?? null
    }

    /** A literal or a ref resolved; objects and lists are resolved member by member. */
    resolve(value: RefOrValue, scope: ExpressionScope): JsonValue {
        if (isStoredRef(value)) return this.resolveRef(value, scope)
        if (Array.isArray(value)) return value.map((part: JsonValue) => this.resolve(part, scope))
        if (isRecord(value)) {
            const resolved: Record<string, JsonValue> = {}
            for (const [name, part] of Object.entries(value)) resolved[name] = this.resolve(part, scope)
            return resolved
        }
        return value
    }

    /** The input of a step: each member of its mapping resolved against the run memory. */
    mapInput(mapping: Readonly<Record<string, RefOrValue>>, scope: ExpressionScope): JsonObject {
        const mapped: Record<string, JsonValue> = {}
        for (const [name, part] of Object.entries(mapping)) mapped[name] = this.resolve(part, scope)
        return mapped
    }

    /** The deepest nesting of `and` / `or` / `not` of an expression (a leaf is 0). */
    depthOf(expr: StoredExpr): number {
        if ("and" in expr) return 1 + Math.max(0, ...expr.and.map((part) => this.depthOf(part)))
        if ("or" in expr) return 1 + Math.max(0, ...expr.or.map((part) => this.depthOf(part)))
        if ("not" in expr) return 1 + this.depthOf(expr.not)
        return 0
    }

    /** The problems of an expression a save would refuse: unknown shape, too deep. Empty when it is valid. */
    problemsOf(expr: unknown): ReadonlyArray<string> {
        if (!isStoredExpr(expr)) return ["shape"]
        return this.depthOf(expr) > EXPRESSION_MAX_DEPTH ? ["depth"] : []
    }

    /** The truth of an expression. One deeper than the bound is `unknown`, never a throw. */
    truthOf(expr: StoredExpr, scope: ExpressionScope): ExprTruth {
        if (this.depthOf(expr) > EXPRESSION_MAX_DEPTH) return "unknown"
        return this.truth(expr, scope)
    }

    /** Whether an expression holds: only `true` holds. */
    holds(expr: StoredExpr, scope: ExpressionScope): boolean {
        return this.truthOf(expr, scope) === true
    }

    /** `core.if`: the branch the expression takes (`unknown` takes `no`) and the step that follows. */
    decide(config: IfConfig, scope: ExpressionScope): IfDecision {
        const truth = this.truthOf(config.when, scope)
        if (truth === true) return { truth, branch: "yes", next: config.yes }
        return { truth, branch: "no", next: config.no ?? null }
    }

    /**
     * `core.set`: the variables update the step returns to the run state, `{ <name>: { value, by, at } }`. Every value is computed against the
     * state as it was BEFORE the step (no name reads a sibling written by the same step); the caller supplies the step key and the instant.
     */
    setVariables(config: CoreSetConfig, scope: ExpressionScope, by: string, at: string): Readonly<Record<string, RunVariable>> {
        const update: Record<string, RunVariable> = {}
        for (const [name, spec] of Object.entries(config.set)) {
            update[name] = { value: this.valueOf(spec, scope), by, at }
        }
        return update
    }

    /** A literal bound inside `[min, max]`; null when the value is not an integer inside them. */
    boundOf(value: JsonValue, limits: BoundLimits): number | null {
        if (typeof value !== "number" || !Number.isInteger(value)) return null
        return value >= limits.min && value <= limits.max ? value : null
    }

    private valueOf(spec: RefOrValue | StoredExpr, scope: ExpressionScope): JsonValue {
        if (isStoredExpr(spec)) {
            const truth = this.truthOf(spec, scope)
            return truth === "unknown" ? null : truth
        }
        return this.resolve(spec, scope)
    }

    private truth(expr: StoredExpr, scope: ExpressionScope): ExprTruth {
        if ("and" in expr) return allOf(expr.and.map((part) => this.truth(part, scope)))
        if ("or" in expr) return anyOf(expr.or.map((part) => this.truth(part, scope)))
        if ("not" in expr) {
            const inner = this.truth(expr.not, scope)
            return inner === "unknown" ? "unknown" : !inner
        }
        const left = this.resolveRef(expr.ref, scope)
        if (!("value" in expr)) return expr.op === "present" ? isPresent(left) : !isPresent(left)
        return compareTruth(expr.op, left, this.resolve(expr.value, scope), expr.caseFold === true)
    }
}
