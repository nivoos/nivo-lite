import type { CellGraphFile, CellKind, CellRef, JsonSchema, JsonValue } from "./cells.contracts"
import { CellsError, CellsErrorCode } from "./errors/cells.error"
import { schemaProblemOf } from "./cell-schema-shape.policy"

/** What the graph check needs to know about one cell a step names. */
export interface GraphCellFact {
    readonly kind: CellKind
    /** A retired version is hidden from new graphs. */
    readonly retired: boolean
    readonly outputSchema: JsonSchema
}

/** The cells a graph may name, resolved by the caller (the package first, then the stored rows). */
export interface GraphFacts {
    readonly cellOf: (ref: CellRef) => GraphCellFact | null
}

type Raw = { readonly [member: string]: JsonValue }

/** The place a check stands in: the steps of one region (the graph, or the body of a loop) and whether `item` is in scope. */
interface Scope {
    readonly steps: Raw
    readonly start: JsonValue | undefined
    readonly inLoop: boolean
}

/** What every check of one graph shares. */
interface Context {
    readonly label: string
    readonly vars: Raw
    readonly facts: GraphFacts
    /** Every step of the graph, loop bodies included, by key: a `steps.<key>.output` ref may name any of them. */
    readonly all: ReadonlyMap<string, Raw>
}

const STEP_KINDS: ReadonlySet<string> = new Set(["node", "core.if", "core.loop", "core.wait", "core.hand-back", "core.call-workflow", "core.outcome", "core.set"])
const LEAF_OPS: ReadonlySet<string> = new Set(["present", "absent", "eq", "ne", "gt", "gte", "lt", "lte", "contains"])
const ORDER_OPS: ReadonlySet<string> = new Set(["gt", "gte", "lt", "lte"])
const MAX_EXPR_DEPTH = 4
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u
const VAR_NAME = /^[a-z][A-Za-z0-9_]{0,39}$/u
const DURATION_UNITS: ReadonlySet<string> = new Set(["minutes", "hours", "days"])

const isRaw = (value: JsonValue | undefined): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value)

const isStoredRef = (value: JsonValue | undefined): value is Raw => isRaw(value) && typeof value.$ref === "string"

const isExpr = (value: JsonValue | undefined): value is Raw =>
    isRaw(value) && ("op" in value || "and" in value || "or" in value || "not" in value) && !("$ref" in value)

/** Stops a check with the typed error; caught once at the top of `graphProblemOf`. */
const fail = (code: CellsErrorCode, params: Readonly<Record<string, string | number>>): never => {
    throw new CellsError({ code, params })
}

const badConfig = (ctx: Context, step: string, path: string): never => fail(CellsErrorCode.BodyInvalid, { ref: `${ctx.label}#${step}`, path })

const badExpr = (step: string, path: string, reason: string): never => fail(CellsErrorCode.ExprInvalid, { path: `${step}.${path}`, reason })

/** Whether `value` is an integer within the range. */
const intWithin = (value: JsonValue | undefined, low: number, high: number): boolean => typeof value === "number" && Number.isInteger(value) && value >= low && value <= high

/** The steps of a region as `[key, step]` pairs, each proven an object with a known kind. */
const stepsOf = (steps: Raw, ctx: Context, where: string): ReadonlyArray<readonly [string, Raw]> =>
    Object.entries(steps).map(([key, step]) => (isRaw(step) && typeof step.kind === "string" && STEP_KINDS.has(step.kind) ? ([key, step] as const) : badConfig(ctx, `${where}${key}`, "kind")))

/** Collects every step of the graph, loop bodies included. */
const flatten = (steps: Raw, into: Map<string, Raw>): void => {
    for (const [key, step] of Object.entries(steps)) {
        if (!isRaw(step)) continue
        into.set(key, step)
        const body = isRaw(step.config) && isRaw(step.config.body) ? step.config.body : undefined
        if (step.kind === "core.loop" && body !== undefined && isRaw(body.steps)) flatten(body.steps, into)
    }
}

/** Every node step's cell ref of a graph, loop bodies included; a malformed step names none. For the caller to resolve before the check. */
export const nodeRefsOf = (graph: CellGraphFile): ReadonlyArray<CellRef> => {
    const all = new Map<string, Raw>()
    if (isRaw(graph.steps as unknown as JsonValue)) flatten(graph.steps as unknown as Raw, all)
    return [...all.values()]
        .filter((step) => step.kind === "node" && isRaw(step.cell) && typeof step.cell.key === "string" && typeof step.cell.version === "number")
        .map((step) => step.cell as unknown as CellRef)
}

/** Whether the output schema allows a member path, walking `properties` while the schema lists them. */
const outputAllows = (schema: JsonValue | undefined, path: ReadonlyArray<string>): boolean => {
    let node = schema
    for (const segment of path) {
        if (!isRaw(node)) return true
        const properties = node.properties
        if (isRaw(properties)) {
            if (segment in properties) node = properties[segment]
            else return node.additionalProperties === true || isRaw(node.patternProperties)
        } else if (isRaw(node.items) && /^\d+$/u.test(segment)) {
            node = node.items
        } else {
            return true
        }
    }
    return true
}

/** The checks of one `$ref`: the region it names exists, a variable is declared, a step is in the graph, `item` is inside a loop. */
const checkRef = (reference: Raw, step: string, scope: Scope, ctx: Context): void => {
    const path = String(reference.$ref)
    const segments = path.split(".")
    const [root = "", second = ""] = segments
    if (segments.some((segment) => segment === "")) return badExpr(step, "ref", `ref_malformed:${path}`)
    if (root === "trigger") return segments.length >= 2 ? undefined : badExpr(step, "ref", "ref_needs_a_member:trigger")
    if (root === "item") return scope.inLoop ? undefined : badExpr(step, "ref", "item_outside_loop")
    if (root === "vars") {
        if (segments.length < 2) return badExpr(step, "ref", "ref_needs_a_member:vars")
        return second in ctx.vars ? undefined : fail(CellsErrorCode.VarUndeclared, { graph: ctx.label, step, name: second })
    }
    if (root !== "steps") return badExpr(step, "ref", `ref_root_unknown:${root}`)
    const target = ctx.all.get(second)
    if (segments.length < 3 || segments[2] !== "output") return badExpr(step, "ref", `ref_must_be_steps.<key>.output:${path}`)
    if (target === undefined) return badExpr(step, "ref", `ref_unknown_step:${second}`)
    const cell = target.kind === "node" && isRaw(target.cell) ? ctx.facts.cellOf(target.cell as unknown as CellRef) : null
    return cell === null || outputAllows(cell.outputSchema, segments.slice(3)) ? undefined : badExpr(step, "ref", `ref_member_unknown:${path}`)
}

/** Checks every ref inside a literal or mapping (a member that is `{ $ref }` is a ref; anything else is walked). */
const checkValue = (value: JsonValue | undefined, step: string, scope: Scope, ctx: Context): void => {
    if (Array.isArray(value)) {
        for (const item of value) checkValue(item, step, scope, ctx)
        return
    }
    if (isStoredRef(value)) {
        const extra = Object.keys(value).find((name) => name !== "$ref" && name !== "default" && name !== "round")
        if (extra !== undefined) badExpr(step, "ref", `ref_member_unknown:${extra}`)
        if (value.round !== undefined && value.round !== "previous") badExpr(step, "ref", "round_must_be_previous")
        checkRef(value, step, scope, ctx)
        return
    }
    if (isRaw(value)) for (const member of Object.values(value)) checkValue(member, step, scope, ctx)
}

/** Whether a literal can be compared by order: a number or an ISO instant. */
const orderable = (value: JsonValue | undefined): boolean => typeof value === "number" || (typeof value === "string" && ISO_INSTANT.test(value))

/** Checks a stored expression: depth, operators, refs and the types an order comparison allows. */
const checkExpr = (expr: JsonValue | undefined, step: string, at: string, depth: number, scope: Scope, ctx: Context): void => {
    if (!isRaw(expr)) return badExpr(step, at, "expression_must_be_an_object")
    if (depth > MAX_EXPR_DEPTH) return badExpr(step, at, `expression_deeper_than_${String(MAX_EXPR_DEPTH)}`)
    for (const group of ["and", "or"]) {
        const items = expr[group]
        if (items === undefined) continue
        if (!Array.isArray(items) || items.length === 0 || Object.keys(expr).length !== 1) return badExpr(step, at, `${group}_needs_a_non_empty_list`)
        for (const [index, item] of items.entries()) checkExpr(item, step, `${at}.${group}[${String(index)}]`, depth + 1, scope, ctx)
        return
    }
    if (expr.not !== undefined) return Object.keys(expr).length === 1 ? checkExpr(expr.not, step, `${at}.not`, depth + 1, scope, ctx) : badExpr(step, at, "not_takes_one_expression")
    const { op, ref, value } = expr
    if (typeof op !== "string" || !LEAF_OPS.has(op)) return badExpr(step, at, `operator_unknown:${String(op)}`)
    if (!isStoredRef(ref)) return badExpr(step, at, "ref_must_be_a_stored_ref")
    checkValue(ref, step, scope, ctx)
    const needsValue = op !== "present" && op !== "absent"
    if (needsValue !== (value !== undefined)) return badExpr(step, at, needsValue ? "value_missing" : "value_not_allowed")
    if (expr.caseFold !== undefined && (expr.caseFold !== true || (op !== "eq" && op !== "ne" && op !== "contains"))) return badExpr(step, at, "caseFold_is_true_on_eq_ne_contains")
    if (ORDER_OPS.has(op) && !isStoredRef(value) && !orderable(value)) return badExpr(step, at, "order_compares_numbers_or_instants")
    checkValue(value, step, scope, ctx)
    return undefined
}

/** A route target must name a step of the region; an absent route ends the region. */
const checkRoute = (scope: Scope, ctx: Context, step: string, route: string, target: JsonValue | undefined): void => {
    if (target === undefined) return
    if (typeof target !== "string" || !(target in scope.steps)) fail(CellsErrorCode.GraphRouteMissing, { graph: ctx.label, step, route })
}

/** The route targets a step leads to, as `[route, target]` pairs. */
const edgesOf = (step: Raw): ReadonlyArray<readonly [string, JsonValue | undefined]> => {
    const config = isRaw(step.config) ? step.config : {}
    switch (step.kind) {
        case "node":
            return [["next", step.next], ...(isRaw(step.routes) ? Object.entries(step.routes).map(([name, to]) => [`routes.${name}`, to] as const) : [])]
        case "core.if":
            return [["yes", step.yes], ["no", step.no]]
        case "core.loop":
            return [["next", config.next], ["exhausted", config.exhausted], ["unsuccessful", config.unsuccessful]]
        case "core.wait":
            return [["next", config.next], ["onTimeout", config.onTimeout]]
        case "core.outcome":
            return []
        default:
            return [["next", config.next]]
    }
}

/** Fails with `GRAPH_CYCLE` when the region's routes loop back (a loop's own body is its own region, so only a route cycle counts). */
const checkCycles = (scope: Scope, ctx: Context): void => {
    const state = new Map<string, "open" | "done">()
    const visit = (key: string): void => {
        if (state.get(key) === "done") return
        if (state.get(key) === "open") fail(CellsErrorCode.GraphCycle, { graph: ctx.label, step: key })
        state.set(key, "open")
        const step = scope.steps[key]
        if (isRaw(step)) for (const [, to] of edgesOf(step)) if (typeof to === "string" && to in scope.steps) visit(to)
        state.set(key, "done")
    }
    for (const key of Object.keys(scope.steps)) visit(key)
}

/** A duration object: minutes, hours or days, each above 0, at least one. */
const isDuration = (value: JsonValue | undefined): boolean =>
    isRaw(value) && Object.keys(value).length > 0 && Object.entries(value).every(([unit, amount]) => DURATION_UNITS.has(unit) && typeof amount === "number" && amount > 0)

const checkNode = (key: string, step: Raw, scope: Scope, ctx: Context): void => {
    const ref = step.cell
    if (!isRaw(ref) || typeof ref.key !== "string" || !intWithin(ref.version, 1, Number.MAX_SAFE_INTEGER)) return badConfig(ctx, key, "cell")
    const cellRef = ref as unknown as CellRef
    const refText = `${cellRef.kind}:${cellRef.key}@${String(cellRef.version)}`
    if (cellRef.kind !== "node") return fail(CellsErrorCode.KindMismatch, { ref: refText, expected: "node" })
    const fact = ctx.facts.cellOf(cellRef)
    if (fact === null || fact.retired) return fail(CellsErrorCode.GraphRefUnknown, { graph: ctx.label, step: key, ref: refText })
    if (step.mode !== "auto" && step.mode !== "ask") return badConfig(ctx, key, "mode")
    if (!Array.isArray(step.accounts) || step.accounts.some((name) => typeof name !== "string")) return badConfig(ctx, key, "accounts")
    if (step.input !== undefined && !isRaw(step.input)) return badConfig(ctx, key, "input")
    if (step.routes !== undefined && !isRaw(step.routes)) return badConfig(ctx, key, "routes")
    checkValue(step.input, key, scope, ctx)
    return undefined
}

const checkSet = (key: string, step: Raw, scope: Scope, ctx: Context): void => {
    const set = isRaw(step.config) ? step.config.set : undefined
    if (!isRaw(set) || Object.keys(set).length === 0) return badConfig(ctx, key, "config.set")
    for (const [name, value] of Object.entries(set)) {
        if (!(name in ctx.vars)) fail(CellsErrorCode.VarUndeclared, { graph: ctx.label, step: key, name })
        if (isExpr(value)) checkExpr(value, key, `set.${name}`, 1, scope, ctx)
        else checkValue(value, key, scope, ctx)
    }
}

const checkWait = (key: string, step: Raw, scope: Scope, ctx: Context): void => {
    const config = isRaw(step.config) ? step.config : {}
    const keys = config.keys
    if (!Array.isArray(keys) || keys.length < 1 || keys.length > 5) return badConfig(ctx, key, "config.keys")
    for (const [index, item] of keys.entries()) {
        if (!isRaw(item) || typeof item.verb !== "string" || item.verb === "") return badConfig(ctx, key, `config.keys[${String(index)}].verb`)
        if (item.match !== undefined && !isRaw(item.match)) return badConfig(ctx, key, `config.keys[${String(index)}].match`)
        if (item.where !== undefined) checkExpr(item.where, key, `keys[${String(index)}].where`, 1, scope, ctx)
    }
    return config.timeout === undefined || isDuration(config.timeout) ? undefined : badConfig(ctx, key, "config.timeout")
}

const checkHandBack = (key: string, step: Raw, scope: Scope, ctx: Context): void => {
    const target = isRaw(step.config) ? step.config.wait : undefined
    const waiting = typeof target === "string" ? scope.steps[target] : undefined
    if (!isRaw(waiting) || waiting.kind !== "core.wait") badConfig(ctx, key, "config.wait")
}

const checkCall = (key: string, step: Raw, scope: Scope, ctx: Context): void => {
    const config = isRaw(step.config) ? step.config : {}
    if (typeof config.graph !== "string" || config.graph === "") return badConfig(ctx, key, "config.graph")
    if (!intWithin(config.version, 1, Number.MAX_SAFE_INTEGER)) return badConfig(ctx, key, "config.version")
    if (config.input !== undefined && !isRaw(config.input)) return badConfig(ctx, key, "config.input")
    checkValue(config.input, key, scope, ctx)
    return undefined
}

const checkOutcome = (key: string, step: Raw, scope: Scope, ctx: Context): void => {
    const config = isRaw(step.config) ? step.config : {}
    if (typeof config.name !== "string" || config.name === "") return badConfig(ctx, key, "config.name")
    if (config.output !== undefined && !isRaw(config.output)) return badConfig(ctx, key, "config.output")
    checkValue(config.output, key, scope, ctx)
    return undefined
}

/** The loop's own checks: over or until, the bounds of V1's loop, a body region of its own. */
const checkLoop = (key: string, step: Raw, scope: Scope, ctx: Context): void => {
    const config = isRaw(step.config) ? step.config : {}
    const { over, until, body } = config
    if ((over === undefined) === (until === undefined)) return badConfig(ctx, key, "config.over|until")
    if (!isRaw(body) || !isRaw(body.steps) || typeof body.start !== "string") return badConfig(ctx, key, "config.body")
    const inner: Scope = { steps: body.steps, start: body.start, inLoop: true }
    const waits = Object.values(body.steps).some((inside) => isRaw(inside) && inside.kind === "core.wait")
    if (over !== undefined) {
        if (!isStoredRef(over)) return badConfig(ctx, key, "config.over")
        checkValue(over, key, scope, ctx)
        if (typeof config.key !== "string" || config.key === "") return badConfig(ctx, key, "config.key")
        if (!intWithin(config.max, 1, 50)) return badConfig(ctx, key, "config.max")
        if (config.concurrency !== undefined && !intWithin(config.concurrency, 1, 5)) return badConfig(ctx, key, "config.concurrency")
    } else {
        checkExpr(until, key, "until", 1, inner, ctx)
        if (!intWithin(config.max, 1, waits ? 30 : 10)) return badConfig(ctx, key, "config.max")
        if (config.every !== undefined && !isDuration(config.every)) return badConfig(ctx, key, "config.every")
        if (typeof config.exhausted !== "string") return badConfig(ctx, key, "config.exhausted")
    }
    checkRegion(inner, ctx, `${key}/`)
}

/** Checks one step by its kind. */
const checkStep = (key: string, step: Raw, scope: Scope, ctx: Context): void => {
    switch (step.kind) {
        case "node":
            return checkNode(key, step, scope, ctx)
        case "core.if":
            if (typeof step.yes !== "string") return badConfig(ctx, key, "yes")
            if (step.label !== undefined && !(isRaw(step.label) && typeof step.label.vi === "string" && typeof step.label.en === "string")) return badConfig(ctx, key, "label")
            return checkExpr(step.when, key, "when", 1, scope, ctx)
        case "core.set":
            return checkSet(key, step, scope, ctx)
        case "core.wait":
            return checkWait(key, step, scope, ctx)
        case "core.hand-back":
            return checkHandBack(key, step, scope, ctx)
        case "core.call-workflow":
            return checkCall(key, step, scope, ctx)
        case "core.outcome":
            return checkOutcome(key, step, scope, ctx)
        default:
            return checkLoop(key, step, scope, ctx)
    }
}

/** Checks one region: its start, every step, every route, and that its routes hold no cycle. */
function checkRegion(scope: Scope, ctx: Context, where: string): void {
    const steps = stepsOf(scope.steps, ctx, where)
    if (typeof scope.start !== "string" || !(scope.start in scope.steps)) fail(CellsErrorCode.GraphRouteMissing, { graph: ctx.label, step: `${where}(start)`, route: "start" })
    for (const [key, step] of steps) {
        checkStep(key, step, scope, ctx)
        for (const [route, to] of edgesOf(step)) checkRoute(scope, ctx, key, route, to)
    }
    checkCycles(scope, ctx)
}

/** The variable names a region writes with `core.set`, with the step keys that write them (loop bodies included). */
const writesOf = (steps: Raw, into: Map<string, Array<string>>): void => {
    for (const [key, step] of Object.entries(steps)) {
        if (!isRaw(step)) continue
        const config = isRaw(step.config) ? step.config : {}
        if (step.kind === "core.set" && isRaw(config.set)) for (const name of Object.keys(config.set)) into.set(name, [...(into.get(name) ?? []), key])
        if (step.kind === "core.loop" && isRaw(config.body) && isRaw(config.body.steps)) writesOf(config.body.steps, into)
    }
}

/** D1: the iterations of a loop that runs more than one at once all write the variable a body step sets, so the variable must declare a merge. */
const checkParallelWrites = (steps: Raw, ctx: Context): void => {
    for (const step of Object.values(steps)) {
        const config = isRaw(step) && isRaw(step.config) ? step.config : {}
        if (!isRaw(step) || step.kind !== "core.loop" || !isRaw(config.body) || !isRaw(config.body.steps)) continue
        if (typeof config.concurrency === "number" && config.concurrency > 1) {
            const writes = new Map<string, Array<string>>()
            writesOf(config.body.steps, writes)
            for (const [name, keys] of writes) {
                const declared = ctx.vars[name]
                if (!isRaw(declared) || declared.merge === undefined) fail(CellsErrorCode.VarWriteConflict, { graph: ctx.label, name, steps: keys.join(", ") })
            }
        }
        checkParallelWrites(config.body.steps, ctx)
    }
}

/** The declaration of the graph's variables: a valid name, a valid schema, and a merge only on a list. */
const checkVars = (vars: JsonValue | undefined, label: string): Raw => {
    if (vars === undefined) return {}
    if (!isRaw(vars)) return fail(CellsErrorCode.BodyInvalid, { ref: label, path: "vars" })
    for (const [name, declared] of Object.entries(vars)) {
        if (!VAR_NAME.test(name) || !isRaw(declared)) fail(CellsErrorCode.BodyInvalid, { ref: label, path: `vars.${name}` })
        const declaration = declared as Raw
        const problem = schemaProblemOf(declaration.schema, declaration.schema, `vars.${name}.schema`)
        if (problem !== null) fail(CellsErrorCode.SchemaInvalid, { ref: label, path: problem })
        const { merge, schema } = declaration
        if (merge !== undefined && (merge !== "append" || !isRaw(schema) || schema.type !== "array")) fail(CellsErrorCode.BodyInvalid, { ref: label, path: `vars.${name}.merge` })
    }
    return vars
}

/** Each trigger names its verb. */
const checkTriggers = (triggers: JsonValue | undefined, label: string): void => {
    if (!Array.isArray(triggers)) return fail(CellsErrorCode.BodyInvalid, { ref: label, path: "triggers" })
    for (const [index, trigger] of triggers.entries())
        if (!isRaw(trigger) || typeof trigger.verb !== "string" || trigger.verb === "") fail(CellsErrorCode.BodyInvalid, { ref: label, path: `triggers[${String(index)}].verb` })
    return undefined
}

/**
 * The first reason a graph cannot be stored, as the typed error, or null. Every node step names an existing, approved node cell version;
 * every route leads to a step; a route cycle is refused (a loop's body is its own region); every expression is at most 4 deep with its
 * operators and types right; every `$ref` resolves (`trigger.*`, `steps.<key>.output.*` with a member the node's output schema lists,
 * `item.*` inside a loop, `vars.<name>` only for a declared variable); `core.set` writes declared variables only; iterations that run
 * in parallel never write a variable that declares no merge (CELLS-DECISIONS D1); the config of every control step is valid.
 */
export const graphProblemOf = (graph: CellGraphFile, facts: GraphFacts): CellsError | null => {
    const label = `graph:${graph.key}@${String(graph.version)}`
    const steps = graph.steps as unknown as JsonValue
    try {
        const vars = checkVars(graph.vars as unknown as JsonValue | undefined, label)
        checkTriggers(graph.triggers as unknown as JsonValue, label)
        if (!isRaw(steps) || Object.keys(steps).length === 0) return fail(CellsErrorCode.BodyInvalid, { ref: label, path: "steps" })
        const all = new Map<string, Raw>()
        flatten(steps, all)
        const ctx: Context = { label, vars, facts, all }
        checkRegion({ steps, start: graph.start, inLoop: false }, ctx, "")
        checkParallelWrites(steps, ctx)
        return null
    } catch (cause: unknown) {
        if (cause instanceof CellsError) return cause
        throw cause
    }
}
