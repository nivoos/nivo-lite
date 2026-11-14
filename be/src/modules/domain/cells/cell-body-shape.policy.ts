import type { CellKind, JsonObject, JsonValue } from "./cells.contracts"

/** How one member of a `body` is checked: a type name, or a list of the words it may be. */
type MemberKind = "string" | "boolean" | "object" | "string[]" | "any" | ReadonlyArray<string>

/** The members one kind's body may carry, and which of them it must carry. */
interface BodyShape {
    readonly required: ReadonlyArray<string>
    readonly members: Readonly<Record<string, MemberKind>>
}

const NONE: BodyShape = { required: [], members: {} }

/** The body of each kind (CELLS-PLAN 1.3, "what the kind adds on its row"); a control kind carries none, its config lives on the graph step. */
const BODY_SHAPES: Readonly<Record<CellKind, BodyShape>> = {
    operation: {
        required: ["provider", "method", "path"],
        members: {
            provider: "string",
            method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
            path: "string",
            request: "object",
            response: "object",
            errors: "object",
            leastRole: "string",
            replayKeyHeader: "string",
        },
    },
    tool: {
        required: ["account", "servedBy"],
        members: { account: ["none", "owner", "any", "each"], servedBy: "any", owners: "string[]", approvalContent: "object", codeInput: "string" },
    },
    node: {
        required: [],
        members: {
            mode: ["auto", "ask"],
            accounts: "string[]",
            model: "string",
            routes: "string[]",
            requires: "string[]",
            blocking: "boolean",
            facts: "object",
            sensitive: "boolean",
            description: "string",
        },
    },
    trigger: {
        required: [],
        members: {
            via: "string",
            feeds: "string",
            settle: "string",
            combine: "string",
            subject: "string",
            factKey: "string",
            withoutPoll: "boolean",
            words: "object",
            switch: "boolean",
            dataType: "string",
            map: "object",
        },
    },
    provider: {
        required: ["roles", "auth", "baseUrl"],
        members: {
            roles: "string[]",
            auth: "object",
            baseUrl: "string",
            accountFields: "string[]",
            webhook: "object",
            poll: "object",
            owns: "object",
            sandbox: "object",
            accountOwner: ["platform", "workspace"],
        },
    },
    "core.if": NONE,
    "core.loop": NONE,
    "core.wait": NONE,
    "core.hand-back": NONE,
    "core.call-workflow": NONE,
    "core.outcome": NONE,
    "core.set": NONE,
}

const isObject = (value: JsonValue | undefined): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value)

/** The reason a member does not fit its kind of value, or null. */
const memberProblem = (kind: MemberKind, value: JsonValue): string | null => {
    if (Array.isArray(kind)) return typeof value === "string" && kind.includes(value) ? null : `must be one of ${kind.join(", ")}`
    switch (kind) {
        case "string":
            return typeof value === "string" && value !== "" ? null : "must be a non-empty string"
        case "boolean":
            return typeof value === "boolean" ? null : "must be true or false"
        case "object":
            return isObject(value) ? null : "must be an object"
        case "string[]":
            return Array.isArray(value) && value.every((item) => typeof item === "string") ? null : "must be a list of strings"
        default:
            return null
    }
}

/** The reason a tool's `servedBy` is wrong: an object of operation keys by provider, or `primitive:<name>`. */
const servedByProblem = (value: JsonValue): string | null => {
    if (typeof value === "string") return /^primitive:[\w.-]+$/u.test(value) ? null : "a text must be primitive:<name>"
    if (isObject(value)) return Object.values(value).every((operation) => typeof operation === "string") && Object.keys(value).length > 0 ? null : "must map a provider to an operation key"
    return "must be primitive:<name> or an object of operation keys by provider"
}

/**
 * The first reason a `body` is outside its kind's shape, as `<path>: <reason>`, or null. Members are closed per kind (a typo is refused), required
 * members must be present, and a control kind carries no body.
 */
export const bodyProblemOf = (kind: CellKind, body: JsonObject): string | null => {
    const shape = BODY_SHAPES[kind]
    const missing = shape.required.find((name) => body[name] === undefined)
    if (missing !== undefined) return `body.${missing}: required for a ${kind}`
    for (const [name, value] of Object.entries(body)) {
        const known = shape.members[name]
        if (known === undefined) return `body.${name}: not a member of a ${kind} body`
        const problem = name === "servedBy" ? servedByProblem(value) : memberProblem(known, value)
        if (problem !== null) return `body.${name}: ${problem}`
    }
    return null
}
