import type { JsonObject, JsonValue } from "./types"

/** What a tool answered: a value, or a refusal code with facts. */
export type ToolAnswer =
    | { readonly ok: true; readonly value: JsonValue }
    | { readonly ok: false; readonly refusal: string; readonly facts?: JsonObject }

/** The marker `ctx.cannot` answers; a source returns it to end the step as a business ending. */
export interface Cannot {
    readonly cannot: string
}

/** The recorded facts of a run (the clock and the random seed are fixed by the runner's prelude). */
export interface Facts {
    readonly at: string
    readonly day: string
    readonly randomSeed: string
    readonly item: JsonValue
    readonly queue: ReadonlyArray<JsonObject>
    readonly waiting: number
    readonly workspace: JsonObject
}

/** The context of a node source: `function run(input, ctx)`. */
export interface NodeContext {
    tool(name: string, args?: JsonValue): ToolAnswer
    say(prompt: string, data?: JsonValue): JsonValue
    cannot(why: string): Cannot
    readonly facts: Facts
}

/** The context of a trigger source: `function translate(raw)` has no context; it is pure. */
export type TriggerContext = never

/**
 * The contexts by cell kind. EXTENSION POINT: the provider phase adds `operation` (its `http()` and `hmac()` capabilities) by augmenting this
 * interface (`declare module "@nivo-lite/cells-author" { interface CellContexts { operation: ProviderContext } }`) and by shipping
 * `ambient/operation.d.ts` beside `ambient/node.d.ts`; the compile step needs no change because it only erases types and bundles local helpers.
 */
export interface CellContexts {
    node: NodeContext
    trigger: TriggerContext
}
