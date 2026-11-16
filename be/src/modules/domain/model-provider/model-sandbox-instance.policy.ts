/*
 * THE FIXED INSTANCE OF A SCHEMA (sandbox model cases `MODEL-8` / `MODEL-9`): the smallest value that satisfies a JSON Schema, built by its
 * STRUCTURE alone (type, required members, enum, const, bounds, format), never by what its words mean: no keyword list, no matching of a
 * member's name. It is pure and deterministic: the same schema gives the same value on every machine. A schema it cannot satisfy by
 * structure (a `pattern`, a `not`, a refinement of the author's own) yields the nearest value its other keywords allow; the caller then
 * checks the value against the schema it has (the model door's own parse) and sees a failed try, as it would for a live model that
 * answered wrongly. Nothing here reaches a network.
 */

/** A JSON object, as a schema or an instance is. */
type JsonObject = Readonly<Record<string, unknown>>

/** The deepest a nested schema is followed (a recursive schema ends here with its smallest value). */
const MAX_DEPTH = 8

/** The fixed value of each string `format` the JSON Schema vocabulary names. */
const FORMAT_VALUE: Readonly<Record<string, string>> = {
    "date-time": "2026-01-01T00:00:00.000Z",
    date: "2026-01-01",
    time: "00:00:00Z",
    email: "sandbox@nivo.test",
    uri: "urn:nivo:sandbox",
    uuid: "00000000-0000-4000-8000-000000000000",
}

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value)

/** The node a local `$ref` (`#/$defs/x`, `#/definitions/x`) names in the root schema, or undefined. */
const referenced = (root: JsonObject, ref: string): unknown => {
    if (!ref.startsWith("#/")) return undefined
    return ref
        .slice(2)
        .split("/")
        .reduce<unknown>((node, part) => (isObject(node) ? node[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined), root)
}

/** The first type a schema allows that is a value (a nullable `["string", "null"]` gives `string`), else the type implied by its members. */
const typeOf = (schema: JsonObject): string => {
    const declared = schema.type
    const list = typeof declared === "string" ? [declared] : Array.isArray(declared) ? declared.filter((one): one is string => typeof one === "string") : []
    const first = list.find((one) => one !== "null") ?? list[0]
    if (first !== undefined) return first
    if (isObject(schema.properties)) return "object"
    if (schema.items !== undefined) return "array"
    return "any"
}

const numberAt = (schema: JsonObject, key: string): number | null => (typeof schema[key] === "number" ? schema[key] : null)

/** The number nearest zero that meets the bounds (an integer for `integer`). */
const numberOf = (schema: JsonObject, whole: boolean): number => {
    const minimum = numberAt(schema, "minimum")
    const above = numberAt(schema, "exclusiveMinimum")
    const maximum = numberAt(schema, "maximum")
    const below = numberAt(schema, "exclusiveMaximum")
    const low = minimum ?? (above === null ? null : above + (whole ? 1 : 0.5))
    const high = maximum ?? (below === null ? null : below - (whole ? 1 : 0.5))
    const value = Math.min(Math.max(0, low ?? 0), high ?? Number.POSITIVE_INFINITY)
    return whole ? Math.ceil(value) : value
}

/** The smallest string that meets `minLength`, or the fixed value of its `format`. */
const stringOf = (schema: JsonObject): string => {
    const format = typeof schema.format === "string" ? FORMAT_VALUE[schema.format] : undefined
    if (format !== undefined) return format
    const min = numberAt(schema, "minLength") ?? 0
    return "x".repeat(Math.max(0, min))
}

/**
 * The smallest value that satisfies `schema` by structure. `root` is the whole schema (where a local `$ref` is found); `depth` guards a
 * recursive schema.
 */
export const instanceOfSchema = (schema: unknown, root: JsonObject = isObject(schema) ? schema : {}, depth = 0): unknown => {
    if (!isObject(schema) || depth > MAX_DEPTH) return {}
    if ("const" in schema) return schema.const
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
    if (typeof schema.$ref === "string") return instanceOfSchema(referenced(root, schema.$ref), root, depth + 1)
    const alternatives = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null
    if (alternatives !== null && alternatives.length > 0) return instanceOfSchema(alternatives[0], root, depth + 1)
    if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
        const parts = schema.allOf.map((part) => instanceOfSchema(part, root, depth + 1))
        return parts.every(isObject) ? Object.assign({}, ...parts) : parts[0]
    }
    switch (typeOf(schema)) {
        case "object": {
            const properties = isObject(schema.properties) ? schema.properties : {}
            const required = Array.isArray(schema.required) ? schema.required.filter((one): one is string => typeof one === "string") : []
            return Object.fromEntries(required.map((name) => [name, instanceOfSchema(properties[name], root, depth + 1)]))
        }
        case "array": {
            const count = numberAt(schema, "minItems") ?? 0
            return Array.from({ length: Math.max(0, count) }, () => instanceOfSchema(schema.items, root, depth + 1))
        }
        case "string":
            return stringOf(schema)
        case "integer":
            return numberOf(schema, true)
        case "number":
            return numberOf(schema, false)
        case "boolean":
            return false
        case "null":
            return null
        default:
            return {}
    }
}
