import { TOOL } from "@nivo-lite/agent-sdk/names"
import { toolAnswerOf } from "@nivo-lite/agent-sdk/node"
import { canonicalJson } from "@nivo-lite/agent-sdk/template"

/**
 * L2 of every model call of an agent step (agent-sdk "The layout of a model call"): the workspace's policies, as the brain tool
 * `nivo.tool.brain.policy.list` answers them for the turn's agent. WHICH truths, their order and their members are the tool's (the truth
 * graph's policy judgement, in the agent's lens); here the answer is only rendered the same way every time and bounded.
 */

/**
 * The most characters of policies L2 carries: about 4,000 tokens (text and JSON run 2.7-3 characters a token). A fixed bound, so a model
 * call never grows with the size of the workspace's truth graph; the policies past it are counted (`notListed`), never silently dropped.
 */
export const WORKSPACE_POLICIES_MAX_CHARS = 12_000

/**
 * The text of L2: the tool's id, then its answer as key-sorted JSON with its policies kept in the tool's order up to
 * `WORKSPACE_POLICIES_MAX_CHARS` and `notListed` = how many it holds that L2 does not; "" when the read was refused or the workspace has
 * no policy (no layer, no breakpoint). The same answer always gives the same bytes; a changed policy changes L2 and nothing else.
 *
 * @param answer - What `nivo.tool.brain.policy.list` answered.
 * @returns The text of L2.
 */
export const workspacePoliciesTextOf = (answer: unknown): string => {
    const read = toolAnswerOf(answer)
    if (!read.ok) return ""
    const { policies, total, ...rest } = read.value
    const all: ReadonlyArray<unknown> = Array.isArray(policies) ? policies : []
    if (all.length === 0) return ""
    const kept: Array<unknown> = []
    const used = { chars: 0 }
    for (const policy of all) {
        const chars = canonicalJson(policy).length + 1
        if (used.chars + chars > WORKSPACE_POLICIES_MAX_CHARS) break
        kept.push(policy)
        used.chars += chars
    }
    const held = typeof total === "number" && total > all.length ? total : all.length
    return `${TOOL.brainPolicyList}\n${canonicalJson({ ...rest, policies: kept, notListed: held - kept.length })}`
}
