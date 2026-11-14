/*
 * The data shapes the helper emits. They are the author-side copy of the seed file shapes (`CellFile`, `CellGraphFile`, `CellPackageFile` of
 * be/src/modules/domain/cells/cells.contracts.ts): this package imports no `be` path (gate D), so it owns its own copy. A change of the
 * seed format is a change of both; the `emit --check` against the fixture packages proves they agree.
 */

export type JsonValue = string | number | boolean | null | ReadonlyArray<JsonValue> | { readonly [member: string]: JsonValue }
/** A config the helper does not narrow: it may hold refs and expressions beside JSON. */
export type ConfigData = { readonly [member: string]: unknown }
export type JsonObject = { readonly [member: string]: JsonValue }

export type CellKind =
    | "operation"
    | "tool"
    | "node"
    | "trigger"
    | "provider"
    | "core.if"
    | "core.loop"
    | "core.wait"
    | "core.hand-back"
    | "core.call-workflow"
    | "core.outcome"
    | "core.set"

export interface LocalizedText {
    readonly vi: string
    readonly en: string
}

export interface StoredRef {
    readonly $ref: string
    readonly default?: JsonValue
    readonly round?: "previous"
}
export type RefOrValue = StoredRef | JsonValue

export type StoredExpr =
    | { readonly op: "present" | "absent"; readonly ref: StoredRef }
    | {
          readonly op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains"
          readonly ref: StoredRef
          readonly value: RefOrValue
          readonly caseFold?: true
      }
    | { readonly and: ReadonlyArray<StoredExpr> }
    | { readonly or: ReadonlyArray<StoredExpr> }
    | { readonly not: StoredExpr }

export interface CellRef {
    readonly kind: CellKind
    readonly key: string
    readonly version: number
}

/** The `cell.yaml` of one cell version. `source` is the COMPILED file name beside it (`run.js`, `translate.js`); its origin is the `.ts` of the same stem. */
export interface CellFileData {
    readonly kind: CellKind
    readonly key: string
    readonly version: number
    readonly title: LocalizedText
    readonly input: JsonObject
    readonly output: JsonObject
    readonly config?: JsonObject
    readonly semantics: JsonObject
    readonly body?: JsonObject
    readonly source?: string
    /** The authoring file beside the data file (`run.ts`); the seed needs it to exist, never stores it. */
    readonly origin?: string
    readonly examples?: ReadonlyArray<JsonObject>
    readonly reviewState?: "draft" | "approved" | "retired"
}

export type GraphStepData =
    | {
          readonly kind: "node"
          readonly cell: CellRef
          readonly input: Readonly<Record<string, RefOrValue>>
          readonly mode: "auto" | "ask"
          readonly accounts: ReadonlyArray<string>
          readonly next?: string
          readonly routes?: Readonly<Record<string, string>>
          readonly unsuccessful?: JsonObject
      }
    | { readonly kind: "core.if"; readonly when: StoredExpr; readonly yes: string; readonly no?: string; readonly label?: LocalizedText }
    | { readonly kind: "core.loop" | "core.wait" | "core.hand-back" | "core.call-workflow" | "core.outcome"; readonly config: ConfigData }
    | { readonly kind: "core.set"; readonly config: { readonly set: Readonly<Record<string, RefOrValue | StoredExpr>>; readonly next?: string } }

export interface GraphVarData {
    readonly schema: JsonObject
    readonly merge?: "append"
}

/** The `graph.yaml` of one graph version. */
export interface GraphFileData {
    readonly key: string
    readonly version: number
    readonly start: string
    readonly triggers: ReadonlyArray<JsonObject>
    readonly steps: Readonly<Record<string, GraphStepData>>
    readonly vars?: Readonly<Record<string, GraphVarData>>
    readonly reviewState?: "draft" | "approved" | "retired"
}

/** The `cells.package.yaml`. */
export interface PackageFileData {
    readonly key: string
    readonly version: string
    readonly visibility: "public" | "private"
    readonly enterprises?: ReadonlyArray<string>
    readonly author: string
}

/** What an author hands to `emit`: the package file, every cell file and every graph file. */
export interface AuthorProject {
    readonly package: PackageFileData
    readonly cells: ReadonlyArray<CellFileData>
    readonly graphs: ReadonlyArray<GraphFileData>
}
