import { toolAnswerOf, type NodeHostPorts, type RefusalDeclarations } from "@nivo-lite/agent-sdk/node"
import { mutatesBySpec } from "@modules/domain/tool-specs"
import { GraphNodesError, GraphNodesErrorCode, isOutcomeUnknownCode } from "./errors/graph-nodes.error"
import { finalRefusalOf } from "./final-refusal.policy"
import { actsOutside } from "./graph-node-effects.service"

/**
 * E-FIX12 rule A-1 (coordinator ruling on D-W3-1; engine words): WHICH ENDING OF A STEP IS BUSINESS AND WHICH IS A FAILED ACT.
 * - Business, and only these (the step's `unsuccessful` declaration governs them, e.g. its `declined` end): the node said it `cannot`
 *   do its business, a person `declined` an approval, a loop ran out of rounds (`exhausted`).
 * - A failed act, never a business ending: a call of a tool that WRITES OUTSIDE NIVO's database (it mutates: the tool's spec, else the
 *   definition's own word, else a write; and it acts outside: `actsOutside`, an undeclared id counts as outside) answered a typed
 *   refusal. A typed refusal is permanent by its type (a write refused only for now throws the transient "not sent, try later" and parks
 *   on the ladder; an outcome nobody knows has its own road). Whatever the node does with the answer (reads it as `cannot`, routes on it,
 *   ignores it), the step stops for a person like a call whose outcome is unknown (R74): ONE stop, one card, no automatic retry, no AI
 *   output, no `unsuccessful` ending, whatever the step declares; the run stays in flight and holds its subject. A refusal of a write
 *   wholly inside NIVO's records (a record `taken`, a contact missing) stays an answer the node decides on.
 * E-FIX12 rule A-5 (coordinator ruling): a stop exists so a PERSON can act on a failed act. A refusal the tool DECLARES final for the
 * subject (`finalRefusals`: nobody may or can make the act happen through this tool; on a core tool's spec, on a plugin's own tool or
 * effect definition: `finalRefusalOf`) is no failed act: it is a business answer, the step's `unsuccessful` declaration applies, no
 * stop. Undeclared = a stop.
 * Read from the call's typed answer and the tool's declarations only, never from words; no tool or channel is named here.
 */

/** True for a call of `tool` that writes outside NIVO's database; `defined` is the tool definition's own `mutates` word, when it has one. */
const writesOutside = (tool: string, defined: boolean | undefined): boolean =>
    (mutatesBySpec(tool) ?? defined ?? true) && actsOutside(tool)

/**
 * The failed act a call's raw answer is (a typed refusal of a write outside), or null: an answer that is no refusal, a refusal of a read
 * or of a write inside, and a refusal whose code says the outcome is unknown (that road stops the node already, R74).
 */
export const actRefusalOf = (
    tool: string,
    raw: unknown,
    defined?: boolean,
    declared?: RefusalDeclarations,
): GraphNodesError | null => {
    const answer = toolAnswerOf(raw)
    if (answer.ok || isOutcomeUnknownCode(answer.refusal) || !writesOutside(tool, defined)) return null
    // A refusal the tool declares FINAL for the subject (rule A-5): nobody can make the act happen, so it is a business answer, no stop.
    if (finalRefusalOf(tool, answer.refusal, declared)) return null
    return new GraphNodesError({ code: GraphNodesErrorCode.ActRefused, params: { effect: tool, outsideRefusal: answer.refusal } })
}

/**
 * The host's ports of one node run with every failed act kept in `asks` (in call order), so the node stops for a person whatever it does
 * with the refusal. Wraps the ports the node is handed (outside the replay wrapper, so a refusal replayed from the checkpoint is kept too);
 * the answer itself reaches the node unchanged. A call a person declined never reaches here as an answer (the host answers it itself).
 */
export const actRefusalsKeptOf = (ports: NodeHostPorts, asks: Array<Error>): NodeHostPorts => ({
    ...ports,
    execute: async (effect, payload, call) => {
        const subject = await ports.execute(effect, payload, call)
        const failed = actRefusalOf(effect.id, subject, true, effect)
        if (failed !== null) asks.push(failed)
        return subject
    },
    callTool: async (tool, args, key) => {
        const answer = await ports.callTool(tool, args, key)
        const failed = actRefusalOf(tool.id, answer, tool.mutates, tool)
        if (failed !== null) asks.push(failed)
        return answer
    },
})
