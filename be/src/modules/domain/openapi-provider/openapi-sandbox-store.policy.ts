import { createHash } from "node:crypto"
import { isRecord } from "@modules/platform/primitives"
import {
    declaredPropertiesOf,
    responseSchemaOf,
    typesOf,
    violationOf,
    type PinnedDocument,
    type PinnedOperation,
    type SchemaNode,
} from "@modules/domain/openapi-tools"
import type { OpenApiSandboxOperationFixture } from "./openapi-sandbox-fixtures.contracts"

/*
 * THE GENERIC STORE OF AN OPENAPI SANDBOX (lane concept provider-sandbox, the `openapi` row): what a sandbox account of a system pinned by
 * its OpenAPI document holds and how each operation of the document reads or changes it. Derived from the DOCUMENT alone (its paths and
 * schemas, never a system's noun, R75): a COLLECTION is the first path segment below the base path; its KEY MEMBER is the parameter of its
 * item path (`/<collection>/{<key>}`). The package that pins the document declares data only (the SDK's `ProviderSandboxOperation`): the
 * records a collection starts with, what an act sets, its own refusal and failure answers. Pure: the reach keeps the state.
 */

/** What an operation does to the account's store, read from its method and path (or from the package's declaration of it). */
export type SandboxResource =
    /** A new record of the collection (POST on the collection). */
    | { readonly kind: "create"; readonly collection: string }
    /** The records of the collection, filtered by the call's parameters that are members of them (GET on the collection or a view of it). */
    | { readonly kind: "list"; readonly collection: string }
    /** One record by the path parameter (GET on an item). */
    | { readonly kind: "read"; readonly collection: string; readonly keyParam: string }
    /** The request body laid over one record (PATCH / PUT on an item, or an act on it: POST below an item). */
    | { readonly kind: "update"; readonly collection: string; readonly keyParam: string }
    /** One record removed (DELETE on an item). */
    | { readonly kind: "remove"; readonly collection: string; readonly keyParam: string }
    /** One record shaped to another answer (GET below an item whose answer is no list). */
    | { readonly kind: "project"; readonly collection: string; readonly keyParam: string }
    /** The records of another collection that name the item (GET below an item whose answer is a list). */
    | { readonly kind: "children"; readonly collection: string; readonly keyParam: string; readonly child: string }
    /** An answer of the whole collection that is no list (counts are the sizes of the collections the answer's members name). */
    | { readonly kind: "summary"; readonly collection: string }
    /** The package's fixed answer (a declaration with no state member): no store. */
    | { readonly kind: "fixed" }

/** One path segment: a fixed word or a parameter. */
type Segment = { readonly param: false; readonly text: string } | { readonly param: true; readonly text: string }

/** The segments of an operation's path below the document's base path. */
export const segmentsOf = (path: string, basePath: string): ReadonlyArray<Segment> => {
    const below = basePath !== "" && path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path
    return below
        .split("/")
        .filter((part) => part !== "")
        .map((part): Segment => {
            const param = /^\{(.+)\}$/u.exec(part)
            return param === null ? { param: false, text: part } : { param: true, text: param[1] ?? part }
        })
}

/** The 2xx status an operation declares first (in number order), else 200. */
export const successStatusOf = (operation: PinnedOperation): number => {
    const declared = Object.keys(operation.responses)
        .filter((status) => /^2\d\d$/u.test(status))
        .map(Number)
        .sort((a, b) => a - b)
    return declared[0] ?? 200
}

/** The schema of the operation's success answer, or null when it declares none with a JSON body. */
export const successSchemaOf = (operation: PinnedOperation): SchemaNode | null => responseSchemaOf(operation, successStatusOf(operation)) ?? null

/** The member of an answer that carries its list: the declared one, else the first member whose schema is a list; null for none. */
export const listMemberOf = (schema: SchemaNode | null, declared?: string): string | null => {
    if (schema === null) return null
    if (declared !== undefined) return declared
    const found = Object.entries(declaredPropertiesOf(schema)).find(([, member]) => typesOf(member)?.includes("array") === true)
    return found?.[0] ?? null
}

/** True when an answer is a list: a list itself, or an object with a list member. */
const listShaped = (schema: SchemaNode | null): boolean =>
    schema !== null && (typesOf(schema)?.includes("array") === true || listMemberOf(schema) !== null)

/**
 * The key member of every collection of a document: the parameter of its item path (`/<collection>/{<key>}`), the first one found.
 * A collection with no item path has none (its records are kept by a generated key the answers never show).
 */
export const keyMembersOf = (document: PinnedDocument): ReadonlyMap<string, string> => {
    const keys = new Map<string, string>()
    for (const operation of document.operations.values()) {
        const [collection, key] = segmentsOf(operation.path, document.source.basePath)
        if (collection === undefined || collection.param || key?.param !== true || keys.has(collection.text)) continue
        keys.set(collection.text, key.text)
    }
    return keys
}

/** The collections a document names (the first segment of every path), in document order. */
export const collectionsOf = (document: PinnedDocument): ReadonlyArray<string> => [
    ...new Set(
        [...document.operations.values()].flatMap((operation) => {
            const [first] = segmentsOf(operation.path, document.source.basePath)
            return first === undefined || first.param ? [] : [first.text]
        }),
    ),
]

/** What an operation does, read from its path and method; the package's state member of the operation, when it declares one, wins. */
export const resourceOf = (
    operation: PinnedOperation,
    basePath: string,
    fixture: OpenApiSandboxOperationFixture | undefined,
): SandboxResource => {
    const segments = segmentsOf(operation.path, basePath)
    const [first, second] = segments
    const item = second?.param === true ? second.text : null
    if (fixture?.listsBack !== undefined) return { kind: "list", collection: fixture.listsBack.collection }
    if (fixture?.readsBack !== undefined) return { kind: "read", collection: fixture.readsBack.collection, keyParam: fixture.readsBack.keyParam }
    if (fixture?.keeps !== undefined) {
        const { collection } = fixture.keeps
        return item === null ? { kind: "create", collection } : { kind: "update", collection, keyParam: item }
    }
    if (fixture !== undefined) return { kind: "fixed" }
    if (first === undefined || first.param) return { kind: "summary", collection: "" }
    const collection = first.text
    const answer = successSchemaOf(operation)
    const { method } = operation
    if (item === null) {
        if (method === "GET") return listShaped(answer) ? { kind: "list", collection } : { kind: "summary", collection }
        return { kind: "create", collection }
    }
    if (segments.length === 2) {
        if (method === "GET") return { kind: "read", collection, keyParam: item }
        return method === "DELETE" ? { kind: "remove", collection, keyParam: item } : { kind: "update", collection, keyParam: item }
    }
    if (method !== "GET") return { kind: "update", collection, keyParam: item }
    const child = [...segments].reverse().find((segment) => !segment.param)?.text ?? collection
    return listShaped(answer) ? { kind: "children", collection, keyParam: item, child } : { kind: "project", collection, keyParam: item }
}

/** A number of a schema keyword, or null. */
const numberAt = (schema: SchemaNode, keyword: string): number | null => {
    const value = schema[keyword]
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** The least value a number schema admits (0 when it states none). */
const leastNumberOf = (schema: SchemaNode, integer: boolean): number => {
    const minimum = numberAt(schema, "minimum")
    const above = numberAt(schema, "exclusiveMinimum")
    if (minimum !== null) return schema.exclusiveMinimum === true ? minimum + (integer ? 1 : 0.5) : minimum
    if (above !== null) return above + (integer ? 1 : 0.5)
    const maximum = numberAt(schema, "maximum")
    return maximum !== null && maximum < 0 ? maximum : 0
}

/** The default text of a string schema: as short as its least length admits. */
const leastTextOf = (schema: SchemaNode): string => "x".repeat(Math.max(0, numberAt(schema, "minLength") ?? 0))

/** The value a schema gets when the record holds none: the first enum value, the const, null where admitted, else the least of its type. */
const defaultOf = (schema: SchemaNode): unknown => {
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
    if (schema.const !== undefined) return schema.const
    const types = typesOf(schema) ?? (Object.keys(declaredPropertiesOf(schema)).length > 0 ? ["object"] : [])
    if (types.includes("null")) return null
    if (types.includes("object")) return shapedOf(schema, {})
    if (types.includes("array")) return shapedOf(schema, [])
    if (types.includes("string")) return leastTextOf(schema)
    if (types.includes("integer")) return leastNumberOf(schema, true)
    if (types.includes("number")) return leastNumberOf(schema, false)
    if (types.includes("boolean")) return false
    return null
}

/** The schema of the items of a list schema, or null. */
const itemsOf = (schema: SchemaNode): SchemaNode | null => (isRecord(schema.items) ? schema.items : null)

/**
 * A value made to fit a schema (the document's own answer shape): a value that fits is kept as it is; an object keeps the members the
 * schema declares (each shaped), gets a default for each required member it lacks, and drops what the schema does not admit; a list has
 * its items shaped (and is filled up to its least count); a scalar that does not fit takes the schema's default. Only what the judge of
 * answers (`violationOf`) enforces is made to fit; an annotation such as `format` is not.
 */
export function shapedOf(schema: SchemaNode | null, value: unknown): unknown {
    if (schema === null) return value
    const declared = declaredPropertiesOf(schema)
    const types = typesOf(schema) ?? (Object.keys(declared).length > 0 ? ["object"] : null)
    if (types === null) return value === undefined ? null : value
    if (value !== undefined && violationOf(schema, value) === null) return value
    if (types.includes("object") && isRecord(value)) {
        const required: ReadonlyArray<unknown> = Array.isArray(schema.required) ? schema.required : []
        const shaped: Record<string, unknown> = {}
        for (const [name, member] of Object.entries(declared)) {
            if (value[name] !== undefined) shaped[name] = shapedOf(member, value[name])
            else if (required.includes(name)) shaped[name] = defaultOf(member)
        }
        if (Object.keys(declared).length === 0 && schema.additionalProperties !== false) return { ...value }
        return shaped
    }
    if (types.includes("array") && Array.isArray(value)) {
        const items = itemsOf(schema)
        const shaped = items === null ? [...value] : value.map((item: unknown) => shapedOf(items, item))
        const least = numberAt(schema, "minItems") ?? 0
        const most = numberAt(schema, "maxItems")
        while (shaped.length < least) shaped.push(items === null ? null : defaultOf(items))
        return most === null ? shaped : shaped.slice(0, most)
    }
    if (types.includes("string") && typeof value === "string") {
        const most = numberAt(schema, "maxLength")
        const cut = most === null ? value : value.slice(0, most)
        return cut.length < (numberAt(schema, "minLength") ?? 0) ? leastTextOf(schema) : cut
    }
    return defaultOf(schema)
}

/**
 * The generated key of the n-th record a sandbox account creates in a collection: a uuid-shaped id derived from the account, the
 * collection and the running number (deterministic, unique per account and collection; it fits a `format: uuid` member and any text one).
 */
export const generatedKeyOf = (accountId: string, collection: string, n: number): string => {
    const hex = createHash("sha256").update(`${accountId}\u0000${collection}\u0000${String(n)}`).digest("hex")
    const variant = ((Number.parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** A text of a value (a text or a number), or null: how a key and a parameter are compared. */
export const keyTextOf = (value: unknown): string | null =>
    typeof value === "string" && value !== "" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : null

/**
 * The records a list keeps: those holding, for every given parameter that is a member of the collection's records, the same value; a
 * parameter no record holds as a member (paging, a date window) does not filter. `except` names the parameters that are no filter.
 */
export const filteredOf = (
    records: ReadonlyArray<Readonly<Record<string, unknown>>>,
    params: Readonly<Record<string, unknown>>,
    except: ReadonlyArray<string> = [],
): ReadonlyArray<Readonly<Record<string, unknown>>> => {
    const filters = Object.entries(params).flatMap(([name, value]): Array<[string, string]> => {
        const text = keyTextOf(value)
        if (text === null || except.includes(name) || !records.some((record) => Object.hasOwn(record, name))) return []
        return [[name, text]]
    })
    return records.filter((record) => filters.every(([name, text]) => keyTextOf(record[name]) === text))
}

/** The records of a collection that name an item: those holding a top-level member equal to the item's key (its own key aside). */
export const childrenOf = (
    records: ReadonlyArray<Readonly<Record<string, unknown>>>,
    key: string,
    ownKey: string | undefined,
): ReadonlyArray<Readonly<Record<string, unknown>>> =>
    records.filter((record) => Object.entries(record).some(([name, value]) => name !== ownKey && keyTextOf(value) === key))

/**
 * The members a record lends to a new or changed record that names it: for each member the target's schema declares and the target does
 * not hold yet, the referenced record's member of the same name. A reference is a member whose value is the key of a record of another
 * collection (`references`: the records the call's members name).
 */
export const lentOf = (
    target: Readonly<Record<string, unknown>>,
    schema: SchemaNode | null,
    references: ReadonlyArray<Readonly<Record<string, unknown>>>,
): Readonly<Record<string, unknown>> => {
    if (schema === null) return target
    const lent: Record<string, unknown> = { ...target }
    for (const name of Object.keys(declaredPropertiesOf(schema))) {
        if (lent[name] !== undefined) continue
        const from = references.find((record) => record[name] !== undefined)
        if (from !== undefined) lent[name] = from[name]
    }
    return lent
}

/** The starting records of each collection the package declares: the list member of the default answer of each `listsBack` operation. */
export const startingRecordsOf = (
    fixtures: Readonly<Record<string, OpenApiSandboxOperationFixture>>,
): ReadonlyMap<string, ReadonlyArray<Readonly<Record<string, unknown>>>> => {
    const seeds = new Map<string, Array<Readonly<Record<string, unknown>>>>()
    for (const fixture of Object.values(fixtures)) {
        if (fixture.listsBack === undefined) continue
        const { collection, listField } = fixture.listsBack
        const listed: unknown = Array.isArray(fixture.body) ? fixture.body : isRecord(fixture.body) ? fixture.body[listField] : undefined
        const records = Array.isArray(listed) ? listed.filter((one): one is Record<string, unknown> => isRecord(one)) : []
        seeds.set(collection, [...(seeds.get(collection) ?? []), ...records])
    }
    return seeds
}

/**
 * The kept record a create ANSWERS instead of keeping a new one (the keeps' `reuses`, the system's "the open one is answered" rule): the
 * first record holding the request's value of every member of `by` and, when named, a value of its `whileIn` member among the listed
 * ones; null when none (or when the request gives no value of a member, which names nothing to match).
 */
export const reusedRecordOf = (
    records: ReadonlyArray<Readonly<Record<string, unknown>>>,
    given: Readonly<Record<string, unknown>>,
    reuses: NonNullable<NonNullable<OpenApiSandboxOperationFixture["keeps"]>["reuses"]>,
): Readonly<Record<string, unknown>> | null => {
    if (reuses.by.some((member) => given[member] === undefined)) return null
    const open = reuses.whileIn
    return (
        records.find(
            (record) =>
                reuses.by.every((member) => record[member] === given[member]) &&
                (open === undefined || reuses.whileIn?.values.includes(String(record[open.field])) === true),
        ) ?? null
    )
}

/** The key members the package's `keeps` declarations name, by collection (for a collection the document gives no item path). */
export const declaredKeysOf = (fixtures: Readonly<Record<string, OpenApiSandboxOperationFixture>>): ReadonlyMap<string, string> =>
    new Map(
        Object.values(fixtures).flatMap((fixture): Array<[string, string]> =>
            fixture.keeps === undefined ? [] : [[fixture.keeps.collection, fixture.keeps.keyField]],
        ),
    )
