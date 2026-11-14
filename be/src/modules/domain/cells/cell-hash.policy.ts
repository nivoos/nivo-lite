import { createHash } from "node:crypto"
import type {
    CellExample,
    CellGraphDocument,
    CellRef,
    CellSemantics,
    GraphRef,
    JsonObject,
    JsonSchema,
    LocalizedText,
} from "./cells.contracts"

/**
 * The content a definition hash covers: every member that makes a version what it is, and the sha256 of its source in place of the row id.
 * Not covered, on purpose: the package it was read from, the review state and the review ref (a version re-seeded by a later package version, or
 * retired, is still the same version).
 */
export interface DefinitionContent extends CellRef {
    readonly title: LocalizedText
    readonly inputSchema: JsonSchema
    readonly outputSchema: JsonSchema
    readonly configSchema: JsonSchema
    readonly semantics: CellSemantics
    readonly body: JsonObject
    readonly sourceSha256: string | null
    readonly examples: ReadonlyArray<CellExample>
}

/** The sha256 hex of a text, as the source store keys it. */
export const sha256Of = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex")

/** JSON text with the members of every object sorted and the undefined ones dropped, so two equal contents give the same text whatever their member order. */
export const canonicalJsonOf = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalJsonOf(item)).join(",")}]`
    if (typeof value === "object" && value !== null) {
        const members = Object.entries(value)
            .filter(([, member]) => member !== undefined)
            .sort(([left], [right]) => (left < right ? -1 : 1))
        return `{${members.map(([name, member]) => `${JSON.stringify(name)}:${canonicalJsonOf(member)}`).join(",")}}`
    }
    return JSON.stringify(value) ?? "null"
}

/** The definition hash: sha256 of the canonical content of a cell version (kind, key, version, schemas, semantics, body, examples and its source sha256). */
export const definitionHashOf = (content: DefinitionContent): string =>
    sha256Of(
        canonicalJsonOf({
            kind: content.kind,
            key: content.key,
            version: content.version,
            title: content.title,
            inputSchema: content.inputSchema,
            outputSchema: content.outputSchema,
            configSchema: content.configSchema,
            semantics: content.semantics,
            body: content.body,
            sourceSha256: content.sourceSha256,
            examples: content.examples,
        }),
    )

/** The document hash of a graph version: sha256 of the canonical document (steps with exact cell versions, triggers and the `vars` declaration). */
export const documentHashOf = (document: CellGraphDocument): string => sha256Of(canonicalJsonOf(document))

/** The text of a cell ref in a message and in a cache key: `kind:key@version`. */
export const refTextOf = (ref: CellRef): string => `${ref.kind}:${ref.key}@${String(ref.version)}`

/** The text of a graph ref in a message and in a cache key: `graph:key@version`. */
export const graphRefTextOf = (ref: GraphRef): string => `graph:${ref.key}@${String(ref.version)}`
