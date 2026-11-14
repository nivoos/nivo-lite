// Ambient types of a NODE cell's TypeScript origin (CELLS-DECISIONS D3). The runner's prelude gives a node source these globals and the `ctx`
// argument of `run`; this file declares them for the editor and for `tsc` in the package repo. It is a declaration file: it emits nothing.
// Add to your tsconfig: "types": ["@nivo-lite/cells-author/ambient"], or `/// <reference path=".../ambient/node.d.ts" />`.
//
// Extension point: the capabilities of another kind (`http`, `hmac` for a provider operation, defined in the next phase) are declared in a sibling
// file `ambient/<kind>.d.ts` the same way, and the context types by augmenting `CellContexts` of the package (see src/context.ts).

type CellJson = string | number | boolean | null | ReadonlyArray<CellJson> | { readonly [member: string]: CellJson }
type CellToolAnswer =
    | { readonly ok: true; readonly value: CellJson }
    | { readonly ok: false; readonly refusal: string; readonly facts?: { readonly [member: string]: CellJson } }
interface CellCannot {
    readonly cannot: string
}
interface CellFacts {
    readonly at: string
    readonly day: string
    readonly randomSeed: string
    readonly item: CellJson
    readonly queue: ReadonlyArray<{ readonly [member: string]: CellJson }>
    readonly waiting: number
    readonly workspace: { readonly [member: string]: CellJson }
}
interface CellNodeContext {
    tool(name: string, args?: CellJson): CellToolAnswer
    say(prompt: string, data?: CellJson): CellJson
    cannot(why: string): CellCannot
    readonly facts: CellFacts
}

/** The input the run was given (also the first argument of `run`). */
declare const input: CellJson
/** The recorded facts: the clock and the random seed of the run. */
declare const facts: CellFacts
/** Calls one DECLARED tool (`semantics.tools`); an undeclared one is refused by the runner client. */
declare function tool(name: string, args?: CellJson): CellToolAnswer
/** Turns a request into text through the engine. */
declare function say(prompt: string, data?: CellJson): CellJson
