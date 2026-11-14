import type { JsonValue } from "./cells.contracts"

const TYPE_NAMES: ReadonlySet<string> = new Set(["string", "number", "integer", "boolean", "null", "object", "array"])
const NUMBER_KEYWORDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const
const COUNT_KEYWORDS = ["minLength", "maxLength", "minItems", "maxItems", "minProperties", "maxProperties", "minContains", "maxContains"] as const
const SCHEMA_KEYWORDS = ["items", "additionalProperties", "contains", "not", "if", "then", "else", "propertyNames", "unevaluatedItems", "unevaluatedProperties"] as const
const SCHEMA_LIST_KEYWORDS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const
const SCHEMA_MAP_KEYWORDS = ["properties", "patternProperties", "dependentSchemas", "$defs"] as const
const TEXT_KEYWORDS = ["$schema", "$id", "$comment", "title", "description", "format"] as const
const RANGES: ReadonlyArray<readonly [string, string]> = [
    ["minLength", "maxLength"],
    ["minItems", "maxItems"],
    ["minProperties", "maxProperties"],
    ["minContains", "maxContains"],
    ["minimum", "maximum"],
]

type Plain = { readonly [member: string]: JsonValue }

const isPlain = (value: unknown): value is Plain => typeof value === "object" && value !== null && !Array.isArray(value)

const isList = (value: unknown): value is ReadonlyArray<JsonValue> => Array.isArray(value)

/** Whether a local `$ref` (`#`, `#/$defs/x`) resolves inside the root schema. */
const resolvesLocally = (reference: string, root: JsonValue): boolean => {
    if (reference === "#") return true
    if (!reference.startsWith("#/")) return false
    let node: JsonValue | undefined = root
    for (const part of reference.slice(2).split("/")) {
        const name = part.replaceAll("~1", "/").replaceAll("~0", "~")
        node = isPlain(node) ? node[name] : isList(node) ? node[Number(name)] : undefined
        if (node === undefined) return false
    }
    return true
}

/** The reason one keyword of an object schema is wrong, or null; `at` is the path of the schema. */
const keywordProblem = (schema: Plain, name: string, root: JsonValue, at: string): string | null => {
    const value = schema[name]
    if (value === undefined) return null
    const here = `${at}.${name}`
    if ((TEXT_KEYWORDS as ReadonlyArray<string>).includes(name)) return typeof value === "string" ? null : `${here}: must be a string`
    if ((NUMBER_KEYWORDS as ReadonlyArray<string>).includes(name)) return typeof value === "number" ? null : `${here}: must be a number`
    if ((COUNT_KEYWORDS as ReadonlyArray<string>).includes(name))
        return typeof value === "number" && Number.isInteger(value) && value >= 0 ? null : `${here}: must be a non-negative integer`
    if ((SCHEMA_KEYWORDS as ReadonlyArray<string>).includes(name)) {
        if (name === "items" && isList(value)) return `${here}: must be a schema (a list of positions is prefixItems in 2020-12)`
        return schemaProblemOf(value, root, here)
    }
    if ((SCHEMA_LIST_KEYWORDS as ReadonlyArray<string>).includes(name)) {
        if (!isList(value) || value.length === 0) return `${here}: must be a non-empty list of schemas`
        return value.map((item, index) => schemaProblemOf(item, root, `${here}[${String(index)}]`)).find((found) => found !== null) ?? null
    }
    if ((SCHEMA_MAP_KEYWORDS as ReadonlyArray<string>).includes(name)) {
        if (!isPlain(value)) return `${here}: must be an object of schemas`
        return Object.entries(value).map(([member, item]) => schemaProblemOf(item, root, `${here}.${member}`)).find((found) => found !== null) ?? null
    }
    return null
}

/** The reason one of the value-shaped keywords (type, enum, required, pattern ...) is wrong, or null. */
const valueProblem = (schema: Plain, root: JsonValue, at: string): string | null => {
    const { type, enum: choices, required, pattern, multipleOf, uniqueItems, $ref: reference, dependentRequired } = schema
    if (type !== undefined) {
        const names = isList(type) ? type : [type]
        if (names.length === 0 || names.some((name) => typeof name !== "string" || !TYPE_NAMES.has(name)) || new Set(names).size !== names.length)
            return `${at}.type: must be one of ${[...TYPE_NAMES].join(", ")} (or a list of them, without repeats)`
    }
    if (choices !== undefined && (!isList(choices) || choices.length === 0)) return `${at}.enum: must be a non-empty list`
    if (required !== undefined && (!isList(required) || required.some((name) => typeof name !== "string") || new Set(required).size !== required.length))
        return `${at}.required: must be a list of distinct names`
    if (pattern !== undefined) {
        if (typeof pattern !== "string") return `${at}.pattern: must be a string`
        try {
            new RegExp(pattern, "u")
        } catch {
            return `${at}.pattern: not a valid regular expression`
        }
    }
    if (multipleOf !== undefined && (typeof multipleOf !== "number" || multipleOf <= 0)) return `${at}.multipleOf: must be a number above 0`
    if (uniqueItems !== undefined && typeof uniqueItems !== "boolean") return `${at}.uniqueItems: must be true or false`
    if (reference !== undefined && (typeof reference !== "string" || !resolvesLocally(reference, root))) return `${at}.$ref: must be a local reference that resolves`
    if (dependentRequired !== undefined && (!isPlain(dependentRequired) || Object.values(dependentRequired).some((list) => !isList(list) || list.some((name) => typeof name !== "string"))))
        return `${at}.dependentRequired: must map a name to a list of names`
    return null
}

/** The reason a range is empty (`minItems` above `maxItems`), or null. */
const rangeProblem = (schema: Plain, at: string): string | null => {
    for (const [low, high] of RANGES) {
        const lowValue = schema[low]
        const highValue = schema[high]
        if (typeof lowValue === "number" && typeof highValue === "number" && lowValue > highValue) return `${at}: ${low} is above ${high}`
    }
    const { properties, required } = schema
    if (isPlain(properties) && isList(required)) {
        const missing = required.find((name) => typeof name === "string" && !(name in properties))
        if (missing !== undefined) return `${at}.required: "${String(missing)}" is not in properties`
    }
    return null
}

/**
 * The first reason a value is not a JSON Schema 2020-12 document, as `<path>: <reason>`, or null when it is one. It checks the shape of the
 * keywords the cells use (types, counts, lists of schemas, local references, ranges, `required` inside `properties`); a keyword it does not
 * know is allowed, as the standard allows. The real compile with ajv is slice S4's policy; this check needs nothing installed.
 */
export const schemaProblemOf = (schema: unknown, root: JsonValue = schema as JsonValue, at = "$"): string | null => {
    if (typeof schema === "boolean") return null
    if (!isPlain(schema)) return `${at}: a schema is an object or true / false`
    const names = [...TEXT_KEYWORDS, ...NUMBER_KEYWORDS, ...COUNT_KEYWORDS, ...SCHEMA_KEYWORDS, ...SCHEMA_LIST_KEYWORDS, ...SCHEMA_MAP_KEYWORDS]
    for (const name of names) {
        const problem = keywordProblem(schema, name, root, at)
        if (problem !== null) return problem
    }
    return valueProblem(schema, root, at) ?? rangeProblem(schema, at)
}
