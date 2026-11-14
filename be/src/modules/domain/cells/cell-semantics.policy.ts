import type { CellKind, CellSemantics, ConfirmRead } from "./cells.contracts"

/** What the semantics check needs to know outside the cell itself. */
export interface SemanticsFacts {
    /** The tool cell of a key (in the package or already stored): whether it writes, or null when there is none. */
    readonly toolOf: (key: string) => { readonly mutates: boolean } | null
    /** The members the cell's input schema names, or null when it names none. */
    readonly inputMembers: ReadonlyArray<string> | null
}

/** The most a cell may wait on one execution (CELLS-PLAN 1.4). */
export const MAX_TIMEOUT_MS = 600_000

const CONTROL_KINDS: ReadonlySet<CellKind> = new Set(["core.if", "core.loop", "core.wait", "core.hand-back", "core.call-workflow", "core.outcome", "core.set"])
const MEMBERS: ReadonlySet<string> = new Set([
    "mutates", "outside", "repeatable", "confirmBy", "refusals", "finalRefusals", "onceBy", "readsHeldEvents", "tools", "metered", "timeoutMs",
])

const isNames = (value: unknown): value is ReadonlyArray<string> => Array.isArray(value) && value.every((item) => typeof item === "string" && item !== "")

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The reason the member types are wrong (a list that is not a list of names, a flag that is not a flag), or null. */
const typeProblem = (semantics: Readonly<Record<string, unknown>>): string | null => {
    const unknown = Object.keys(semantics).find((name) => !MEMBERS.has(name))
    if (unknown !== undefined) return `unknown_member:${unknown}`
    if (typeof semantics.mutates !== "boolean") return "mutates_must_be_boolean"
    for (const flag of ["outside", "repeatable"]) if (semantics[flag] !== undefined && typeof semantics[flag] !== "boolean") return `${flag}_must_be_boolean`
    if (semantics.readsHeldEvents !== undefined && semantics.readsHeldEvents !== true) return "readsHeldEvents_must_be_true"
    for (const list of ["refusals", "finalRefusals", "onceBy", "tools"]) if (semantics[list] !== undefined && !isNames(semantics[list])) return `${list}_must_be_names`
    const { timeoutMs, metered } = semantics
    if (timeoutMs !== undefined && (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)) return `timeoutMs_must_be_1_to_${String(MAX_TIMEOUT_MS)}`
    if (metered !== undefined) {
        const price = isObject(metered) ? metered.price : undefined
        const priced = price === "reported" || (isObject(price) && typeof price.usdPerUnit === "number" && price.usdPerUnit > 0)
        if (!isObject(metered) || (metered.usage !== "tokens" && metered.usage !== "units") || !priced) return "metered_must_name_usage_and_price"
    }
    return null
}

/** The reason a confirmation read is wrong (a tool that is not a read, an argument with no source), or null. */
const readProblem = (read: ConfirmRead, facts: SemanticsFacts, where: string): string | null => {
    const tool = facts.toolOf(read.tool)
    if (tool === null) return `${where}_tool_unknown:${read.tool}`
    if (tool.mutates) return `${where}_tool_is_not_a_read:${read.tool}`
    const bad = Object.values(read.args).find((arg) => (arg.from === "value" ? arg.value === undefined : arg.member === undefined))
    return bad === undefined ? null : `${where}_argument_has_no_source`
}

/** The reason a `confirmBy` is wrong, or null. */
const confirmProblem = (semantics: CellSemantics, facts: SemanticsFacts): string | null => {
    const { confirmBy } = semantics
    if (confirmBy === undefined) return null
    if (!semantics.mutates) return "confirmBy_on_a_read"
    if (!isObject(confirmBy.args) || typeof confirmBy.tool !== "string") return "confirmBy_malformed"
    const { member, equals } = confirmBy.happened
    if (typeof member !== "string" || !["string", "number", "boolean"].includes(typeof equals)) return "confirmBy_happened_malformed"
    return readProblem(confirmBy, facts, "confirmBy") ?? (confirmBy.before === undefined ? null : readProblem(confirmBy.before, facts, "confirmBy_before"))
}

/** The reason the write facts contradict each other (finals not in refusals, a read that says it writes outside), or null. */
const writeProblem = (semantics: CellSemantics, inputMembers: ReadonlyArray<string> | null): string | null => {
    const { mutates, refusals = [], finalRefusals = [], onceBy = [] } = semantics
    if (!mutates && finalRefusals.length > 0) return "finalRefusals_on_a_read"
    if (!mutates && semantics.outside !== undefined) return "outside_on_a_read"
    if (!mutates && onceBy.length > 0) return "onceBy_on_a_read"
    const stray = finalRefusals.find((code) => !refusals.includes(code))
    if (stray !== undefined) return `finalRefusals_not_in_refusals:${stray}`
    const unnamed = inputMembers === null ? undefined : onceBy.find((name) => !inputMembers.includes(name))
    return unnamed === undefined ? null : `onceBy_not_in_input:${unnamed}`
}

/** The reason the kind does not allow these facts (tools or held events outside a node, a control cell that writes), or null. */
const kindProblem = (kind: CellKind, semantics: CellSemantics): string | null => {
    if (semantics.readsHeldEvents !== undefined && kind !== "node") return "readsHeldEvents_outside_a_node"
    if (semantics.tools !== undefined && kind !== "node") return "tools_outside_a_node"
    if (CONTROL_KINDS.has(kind) && (semantics.mutates || semantics.metered !== undefined || semantics.repeatable !== undefined)) return "a_control_cell_does_not_write_or_meter"
    return null
}

/** The reason a node's declared tools are wrong (a name no tool cell has), or null. */
const toolsProblem = (semantics: CellSemantics, facts: SemanticsFacts): string | null => {
    const missing = (semantics.tools ?? []).find((name) => facts.toolOf(name) === null)
    return missing === undefined ? null : `tool_unknown:${missing}`
}

/**
 * The first reason the behaviour facts of a cell contradict themselves or its kind, as a short word (`finalRefusals_not_in_refusals:x`), or null.
 * `semantics` is read as untyped data: the file came from yaml, so every member's type is checked before its meaning.
 */
export const semanticsProblemOf = (kind: CellKind, semantics: unknown, facts: SemanticsFacts): string | null => {
    if (!isObject(semantics)) return "semantics_must_be_an_object"
    const shape = typeProblem(semantics)
    if (shape !== null) return shape
    const typed = semantics as unknown as CellSemantics
    return kindProblem(kind, typed) ?? writeProblem(typed, facts.inputMembers) ?? confirmProblem(typed, facts) ?? toolsProblem(typed, facts)
}

/** The tool keys a cell's semantics point at (its node tools and the reads of its `confirmBy`), for the caller to resolve before the check; a malformed member names none. */
export const toolKeysOf = (semantics: unknown): ReadonlyArray<string> => {
    if (!isObject(semantics)) return []
    const { tools, confirmBy } = semantics
    const confirmed = isObject(confirmBy) ? [confirmBy.tool, isObject(confirmBy.before) ? confirmBy.before.tool : undefined] : []
    return [...(isNames(tools) ? tools : []), ...confirmed.filter((name): name is string => typeof name === "string")]
}
