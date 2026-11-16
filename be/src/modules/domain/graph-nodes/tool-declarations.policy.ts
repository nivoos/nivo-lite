import { finalRefusalsOf, type NodeIndex } from "@nivo-lite/agent-sdk/node"
import { mutatesBySpec, toolSpecOf } from "@modules/domain/tool-specs"
import { isOutcomeUnknownCode } from "./errors/graph-nodes.error"

/**
 * E-FIX12 gate (fixing rule 9): the engine decides what a refused or lost act means from what a tool DECLARES (`mutates`, and for a
 * core tool its spec). A tool installed with no boolean `mutates` (a plugin built outside the SDK's types), or whose `mutates` says the
 * opposite of its core spec, would be judged by a guess: the install is refused at boot, naming the tool. An effect is a write by its
 * kind and needs no word. Pure: reads the install and the specs only.
 */
export interface UndeclaredWrite {
    /** The tool id. */
    readonly tool: string
    /** `missing`: no boolean `mutates`; `contradicts`: its `mutates` is not its core spec's. */
    readonly why: "missing" | "contradicts"
}

/** Every installed tool whose write is not declared, or declared against its core spec; empty for a sound install. */
export const undeclaredWritesOf = (index: Pick<NodeIndex, "tools">): ReadonlyArray<UndeclaredWrite> =>
    [...index.tools.values()].flatMap((tool): ReadonlyArray<UndeclaredWrite> => {
        const said: unknown = Reflect.get(tool, "mutates")
        if (typeof said !== "boolean") return [{ tool: tool.id, why: "missing" }]
        const spec = mutatesBySpec(tool.id)
        return spec !== null && spec !== said ? [{ tool: tool.id, why: "contradicts" }] : []
    })

/** One installed definition whose final refusals the engine cannot honour as declared. */
export interface FinalRefusalConflict {
    /** The tool or effect id. */
    readonly tool: string
    /** `over_spec`: the id is a core tool whose own spec holds the declaration (one source, never two); `outcome_unknown`: a final code that says the outcome is unknown (that road is never a business answer). */
    readonly why: "over_spec" | "outcome_unknown"
}

/**
 * SDK-DECL gate (fixing rule 9; the SDK's `defineTool` / `defineEffect` already hold the per-definition checks): a plugin's definition
 * that declares final refusals over an id a core spec declares (two declarations of one tool), or declares an outcome-unknown code final
 * (a call whose outcome nobody knows is never a business answer), is refused at boot, naming the tool. Pure: reads the install and the specs.
 */
export const finalRefusalConflictsOf = (index: Pick<NodeIndex, "tools" | "effects">): ReadonlyArray<FinalRefusalConflict> =>
    [...index.tools.values(), ...index.effects.values()].flatMap((definition): ReadonlyArray<FinalRefusalConflict> => {
        const finals = finalRefusalsOf(definition)
        if (finals.length === 0) return []
        if (toolSpecOf(definition.id) !== null) return [{ tool: definition.id, why: "over_spec" }]
        return finals.some((code) => isOutcomeUnknownCode(code)) ? [{ tool: definition.id, why: "outcome_unknown" }] : []
    })
