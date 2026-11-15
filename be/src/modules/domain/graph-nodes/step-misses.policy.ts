import type { ToolId } from "@nivo-lite/agent-sdk/names"
import { toolAnswerOf, type NodeRun, type RefusalDeclarations } from "@nivo-lite/agent-sdk/node"
import type { DeclinedRefusal } from "@nivo-lite/agent-sdk/template"
import { finalRefusalOf } from "./final-refusal.policy"

/**
 * One call of a step that did not do what it was made for BY A BUSINESS ANSWER, as the engine reports it (ruling R68, narrowed by E-FIX12
 * rules A-1 / A-5): a person declined the approval the call asked for, or the tool answered a refusal it DECLARES final for the subject
 * (nobody can make the act happen through it). Read from the call's typed ANSWER and the tool's declaration only, never from words; the
 * node itself still reads the answer as before. Any other refusal of a write outside is no miss: it is a failed act, the step stops
 * (`act-refusals.policy.ts`).
 */
export type StepMiss =
    | {
          /** A person declined the approval the call asked for. */
          readonly kind: "declined"
          /** The tool whose call was declined. */
          readonly tool: string
      }
    | {
          /** The tool answered a refusal it declares final for the subject. */
          readonly kind: "refused"
          /** The tool called. */
          readonly tool: string
          /** Its typed refusal code. */
          readonly refusal: string
      }

/** What a node run came to on the template road: the SDK's run, with the misses its calls answered (none on the `defineNode` road). */
export interface HostedNodeRun extends NodeRun {
    /** The calls of the step that missed, once each, in call order; absent or empty: none. */
    readonly misses?: ReadonlyArray<StepMiss> | undefined
}

/** The engine's code of a declined approval on the wire. */
const DECLINED: DeclinedRefusal = "declined"

/**
 * The miss one call's raw answer is, or null for an answer that is no miss (a success, any refusal its tool does not declare final);
 * `declared` is the installed definition of the tool or effect when it is a plugin's (`finalRefusalOf`).
 */
export const missOfAnswer = (tool: ToolId, raw: unknown, declared?: RefusalDeclarations): StepMiss | null => {
    const answer = toolAnswerOf(raw)
    if (answer.ok) return null
    if (answer.refusal === DECLINED) return { kind: "declined", tool }
    return finalRefusalOf(tool, answer.refusal, declared) ? { kind: "refused", tool, refusal: answer.refusal } : null
}

/** Adds a miss to the list once: the same call answered again (a replay, an agent's repeat) is one miss. */
export const withMiss = (misses: Array<StepMiss>, miss: StepMiss | null): void => {
    if (miss === null) return
    const same = (one: StepMiss): boolean =>
        one.kind === miss.kind && one.tool === miss.tool && (one.kind !== "refused" || miss.kind !== "refused" || one.refusal === miss.refusal)
    if (!misses.some(same)) misses.push(miss)
}
