import { triggerProblems, type GraphSpec } from "@nivo-lite/agent-sdk/graph"
import {
    type TemplateAgent,
    VERB_SHARED_REFUSED,
    sharedVerbProblems,
    templateGraphProblems,
} from "@nivo-lite/agent-sdk/template"
import { INSTALLED } from "@modules/domain/installed-plugins"
import { providerTriggerLookup } from "@modules/domain/provider-triggers"
import { AgentGraphsError, AgentGraphsErrorCode } from "../errors/agent-graphs.error"
import { GRAPH_TOOL_OUTSIDE_AGENT, withDefaultReads } from "./agent-tools.policy"
import { graphLoopProblemsOf } from "./graph-loops.policy"
import { withSettingsCleared, withSettingsLaid } from "./node-settings.policy"
import { askCalledWritesProblems, templateToolLookupOf, templateTriggerLookup } from "./template-lookups.policy"

/** The text of a value with the keys of every object in order: the database keeps a document with its keys in its own order, so equal content must compare equal. */
const canonicalText = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalText(item)).join(",")}]`
    if (value === null || typeof value !== "object") return String(JSON.stringify(value))
    const entries = Object.entries(value)
        .filter(([, member]) => member !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : 1))
    const members = entries.map(([key, member]) => JSON.stringify(key) + ":" + canonicalText(member))
    return "{" + members.join(",") + "}"
}

/** True when a graph already runs this flow, whatever the order of the keys of either. */
export const sameFlow = (held: GraphSpec | undefined, wanted: GraphSpec): boolean =>
    held !== undefined && canonicalText(held) === canonicalText(wanted)

/** True when a graph's flow changes: one is added, dropped, or holds other content. */
export const flowChanged = (held: GraphSpec | undefined, wanted: GraphSpec | undefined): boolean =>
    wanted === undefined ? held !== undefined : !sameFlow(held, wanted)

/** The tool set the module of a flow declares for its agent, or null when the module declares no agent. */
export const agentToolsOf = (moduleKey: string): ReadonlyArray<string> | null => INSTALLED.agentToolsOf(moduleKey)

/**
 * The trigger problems of a flow that its DERIVED registrations raise: a condition (the graph's `where`, carried onto every derived
 * source, or the verb's own meaning on a source) naming a member that source does not supply (`TRIGGER_CONDITION_UNKNOWN`), or one a
 * provider does not let a registration filter on (`TRIGGER_FILTER_INVALID`). The template checks judge the rest of a trigger.
 */
const DERIVED_CONDITION_CODES: ReadonlySet<string> = new Set(["TRIGGER_CONDITION_UNKNOWN", "TRIGGER_FILTER_INVALID"])

/** One problem of a flow, whichever checks found it. */
export interface FlowProblem {
    readonly code: string
    readonly at: string
}

/**
 * The problem of a flow that is no installed template graph version's copy (the shop's node settings aside, `isCopyOf`): a graph is
 * written in its package and only installed here (owner ruling R89). One graph format: a flow that is no template's copy (an edited
 * copy, a hand-made graph, a flow of node definitions) is refused with this code, never judged by other checks.
 */
export const GRAPH_TEMPLATE_EDITED = "GRAPH_TEMPLATE_EDITED"

/**
 * True when a stored flow is the copy of a template graph's flow (`template`, the graph as the install reads it): equal content for content
 * in everything but the NODE SETTINGS the shop sets on its own copy (`node-settings.policy`: a node step's mode and the accounts it uses,
 * each where the template step takes it). Anything else changed (a step, route, param, trigger, a setting on a step that takes none) is an edit.
 */
const isCopyOf = (template: GraphSpec, flow: GraphSpec): boolean =>
    sameFlow(withSettingsCleared(template, template), withSettingsCleared(template, flow))

/**
 * The problems of a flow (GRAPH-CLEAN rule: the store writes a workflow version only when it is an installed template version with the
 * shop's node settings). The flow must be the COPY of the one an installed template graph of its module reads as (`isCopyOf`: content for content, the shop's node settings aside;
 * else `GRAPH_TEMPLATE_EDITED`); that graph, with the copy's settings laid over it (`withSettingsLaid`), is then judged by the SDK's `templateGraphProblems`
 * with the engine's lookups (known tools, provider owners, money tools, what each verb supplies) and
 * its agent's providers, every tool of its nodes must be in what its module's agent may call (`GRAPH_TOOL_OUTSIDE_AGENT`) when the
 * module declares an agent, every condition its derived registrations carry must read a member its source supplies, and a trigger verb
 * it shares with another graph of its agent must be keyed apart by disjoint exact conditions (`TRIGGER_VERB_SHARED`, judged on the
 * installed template agent while `VERB_SHARED_REFUSED`: install, seed and every publish of a template flow pass here), and a step on
 * `ask` calls at most one write, the default tools its node's examples call counted (`askCalledWritesProblems`, `NODE_ASK_WRITES_MANY`).
 */
export const templateFlowProblems = (flow: GraphSpec): ReadonlyArray<FlowProblem> => {
    const held = INSTALLED.templatesOf(flow.moduleKey).find(
        (template) =>
            INSTALLED.templateGraphOf(template.id) !== null && template.versions.some((version) => isCopyOf(version.graph, flow)),
    )
    const found = held === undefined ? null : INSTALLED.templateGraphOf(held.id)
    if (found === null) return [{ code: GRAPH_TEMPLATE_EDITED, at: flow.moduleKey }]
    const { agent } = found
    const graph = { ...found.graph, spec: withSettingsLaid(found.graph.spec, flow) }
    const declared = agentToolsOf(flow.moduleKey)
    // What the agent may call is the set the run-time grant bounds every run by (`withDefaultReads`: the declared set and the default
    // reads every agent holds); a control step's own effect is the engine's and no template node's tool, so it is not judged here.
    const allowed = declared === null ? null : new Set(withDefaultReads(declared))
    const outside =
        allowed === null
            ? []
            : [...graph.nodes.values()].flatMap((node) =>
                  node.tools
                      .filter((tool) => !allowed.has(tool))
                      .map((tool): FlowProblem => ({ code: GRAPH_TOOL_OUTSIDE_AGENT, at: `${node.id}.tools.${tool}` })),
              )
    const conditions = triggerProblems(flow.triggers, flow.contract, providerTriggerLookup).filter((problem) =>
        DERIVED_CONDITION_CODES.has(problem.code),
    )
    return [
        ...templateGraphProblems(graph.spec, {
            nodes: graph.nodes,
            agentAccounts: agent.accounts,
            tools: templateToolLookupOf(),
            triggers: templateTriggerLookup,
        }),
        // A step on `ask` whose node CALLS more than one write (its declared tools and the default record / file tools its examples call).
        ...askCalledWritesProblems(graph.spec, graph.nodes),
        ...outside,
        ...conditions,
        ...sharedVerbsOf(agent, graph.key),
    ]
}

/** The `TRIGGER_VERB_SHARED` problems of one graph of a template agent, the verb, the graphs and why carried in `at`. */
const sharedVerbsOf = (agent: Pick<TemplateAgent, "key" | "graphs">, graphKey: string): ReadonlyArray<FlowProblem> =>
    VERB_SHARED_REFUSED
        ? sharedVerbProblems(agent)
              .filter((problem) => problem.at.startsWith(`${agent.key}.graphs.${graphKey}.triggers.`))
              .map((problem) => ({ code: problem.code, at: `${problem.at} (${problem.detail ?? ""})` }))
        : []

/**
 * The mode problems of a stored flow (rights rule 1: every node step states ONE mode `auto | ask`; the engine has no default): a step that
 * carries the node contract (`accounts`) and states no mode, or a word that is neither, is `NODE_MODE_UNSTATED` at `<key>.mode`.
 */
export const modeProblemsOf = (flow: GraphSpec): ReadonlyArray<FlowProblem> =>
    flow.nodes.flatMap((node): ReadonlyArray<FlowProblem> => {
        if (node.accounts === undefined) return []
        const own: unknown = node.mode
        return own === "auto" || own === "ask" ? [] : [{ code: NODE_MODE_UNSTATED, at: `${node.key}.mode` }]
    })

/** The problem of a node that states no mode. */
export const NODE_MODE_UNSTATED = "NODE_MODE_UNSTATED"

/** The problems a flow is refused for: the template copy checks, the modes, and the engine's own loop and cycle checks. */
export const flowProblemsOf = (flow: GraphSpec): ReadonlyArray<FlowProblem> => [
    ...templateFlowProblems(flow),
    ...modeProblemsOf(flow),
    // The engine's own loop and cycle checks: a cycle only through a loop, an until loop's cap, branch and condition.
    ...graphLoopProblemsOf(flow),
]

/**
 * Refuses a flow that is no installed template version's copy, or whose copy the template checks, the mode check or the loop checks
 * refuse, naming every problem, with nothing written: the one judgement every road that writes a flow passes (adopting or accepting a
 * template version, a judged rollback, the node settings door, the seed).
 */
export const requireSoundFlow = (flow: GraphSpec): void => {
    const found = flowProblemsOf(flow)
    if (found.length === 0) return
    const listed = found.map((problem) => `${problem.code} ${problem.at}`).join(", ")
    throw new AgentGraphsError({ code: AgentGraphsErrorCode.PublishRefused, params: { problems: listed } })
}
