import type { JsonSchema, JsonValue } from "./cells.contracts"

/*
 * The test kit's own reading of a JSON Schema (CELLS-PLAN 7.4): a value that fits a schema and values that break it, built from the schema ALONE.
 * It is deliberately small (the subset the cell schemas use) and independent of the ajv policy the executor runs, so the kit does not trust the
 * thing it judges. A schema it cannot break answers no violation, and the case that needs one is `na`.
 */

type Member = { readonly [member: string]: JsonValue }

const isMember = (value: JsonValue | undefined): value is Member => typeof value === "object" && value !== null && !Array.isArray(value)

const typeOf = (schema: JsonSchema): string | undefined => {
    const declared = schema.type
    if (typeof declared === "string") return declared
    if (Array.isArray(declared) && typeof declared[0] === "string") return declared[0]
    return undefined
}

const numberOf = (value: JsonValue | undefined): number | undefined => (typeof value === "number" ? value : undefined)

/** A number that fits the bounds of a number or integer schema. */
const numberFitting = (schema: JsonSchema): number => {
    const minimum = numberOf(schema.minimum)
    const exclusiveMinimum = numberOf(schema.exclusiveMinimum)
    const maximum = numberOf(schema.maximum)
    let value = Math.max(1, minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum === undefined ? Number.NEGATIVE_INFINITY : exclusiveMinimum + 1)
    if (maximum !== undefined && value > maximum) value = maximum
    return value
}

/** A value that fits the schema: required members only, the first alternative of a choice, the smallest list that is long enough. */
export const sampleOf = (schema: JsonSchema): JsonValue => {
    if (schema.const !== undefined) return schema.const
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0] ?? null
    for (const choice of ["oneOf", "anyOf"] as const) {
        const alternatives = schema[choice]
        if (Array.isArray(alternatives) && isMember(alternatives[0])) return sampleOf(alternatives[0])
    }
    const properties = isMember(schema.properties) ? schema.properties : {}
    switch (typeOf(schema) ?? (Object.keys(properties).length > 0 ? "object" : undefined)) {
        case "string": {
            const length = Math.max(1, numberOf(schema.minLength) ?? 1)
            return "x".repeat(length)
        }
        case "number":
        case "integer":
            return numberFitting(schema)
        case "boolean":
            return true
        case "null":
            return null
        case "array": {
            const count = numberOf(schema.minItems) ?? 0
            const item = isMember(schema.items) ? sampleOf(schema.items) : null
            return Array.from({ length: count }, () => item)
        }
        case "object": {
            const required = Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === "string") : []
            const sample: Record<string, JsonValue> = {}
            for (const name of required) {
                const part = properties[name]
                sample[name] = isMember(part) ? sampleOf(part) : null
            }
            return sample
        }
        default:
            return {}
    }
}

/** A value of another type than the schema declares, or null when the schema declares none. */
const wrongTypeOf = (schema: JsonSchema): JsonValue | undefined => {
    const declared = Array.isArray(schema.type) ? schema.type : typeof schema.type === "string" ? [schema.type] : []
    if (declared.length === 0) return undefined
    const candidates: ReadonlyArray<readonly [string, JsonValue]> = [
        ["string", "kit-invalid"],
        ["boolean", false],
        ["array", []],
        ["object", {}],
        ["null", null],
    ]
    return candidates.find(([name]) => !declared.includes(name))?.[1]
}

/** Values that break the schema, each by one rule: the wrong type, a value outside `enum` or `const`, a missing required member, a wrong member. Empty when the schema cannot be broken. */
export const violationsOf = (schema: JsonSchema): ReadonlyArray<JsonValue> => {
    const found: Array<JsonValue> = []
    const wrong = wrongTypeOf(schema)
    if (wrong !== undefined) found.push(wrong)
    if (Array.isArray(schema.enum) && schema.enum.length > 0) found.push("kit-outside-enum")
    if (schema.const !== undefined) found.push({ kit: "outside-const" })
    const sample = sampleOf(schema)
    if (isMember(sample)) {
        const required = Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === "string") : []
        const [first] = required
        if (first !== undefined) {
            const { [first]: _dropped, ...rest } = sample
            found.push(rest)
        }
        const properties = isMember(schema.properties) ? schema.properties : {}
        for (const name of required) {
            const part = properties[name]
            const wrongPart = isMember(part) ? wrongTypeOf(part) : undefined
            if (wrongPart !== undefined) {
                found.push({ ...sample, [name]: wrongPart })
                break
            }
        }
    }
    return found
}
