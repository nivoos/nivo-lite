import { DEFAULT_AI_READ_TOOLS, DEFAULT_NODE_TOOLS } from "@nivo-lite/agent-sdk/names"
import { DEFAULT_READ_TOOLS } from "@modules/domain/context-sources"

/** The code of a step whose tool lies outside the tool set of its module's agent. */
export const GRAPH_TOOL_OUTSIDE_AGENT = "GRAPH_TOOL_OUTSIDE_AGENT"

/**
 * An agent's tool set as it holds it: the set its module declares, every default read of the registered context sources (the second
 * brain's search, `nivo.conversation.*`, `nivo.lead.*`), the read-context tools every AI step holds (`DEFAULT_AI_READ_TOOLS`) and the
 * record and file tools every node holds (`DEFAULT_NODE_TOOLS`), in the declared order then the defaults' order, each once: what an AI
 * step is SHOWN (the agent's set, the same for every step). The door still locks the context reads to the run's own conversation and
 * customer, and the record tools reach the calling agent's own records only.
 */
export const withDefaultReads = (declared: ReadonlyArray<string>): ReadonlyArray<string> => [
    ...new Set([...declared, ...DEFAULT_READ_TOOLS, ...DEFAULT_AI_READ_TOOLS, ...DEFAULT_NODE_TOOLS]),
]
