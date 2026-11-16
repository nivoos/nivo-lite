import type { AgentGraphRead } from "./useAgentGraphRead"
import type { AgentGraphUiView } from "./useAgentGraphUi"
import type { useQueryAgentGraphRunSwr, useQueryAgentGraphSwr, useQueryApproverDirectorySwr } from "@/hooks/swr"
import { parseAgentGraphTrace, type AgentGraphWire } from "@/modules/agent-graph"
import type {
    AgentGraphAction,
    AgentGraphCommands,
    AgentGraphMemberData,
    AgentGraphPhoneView,
    AgentGraphSideTab,
    SlotRead,
} from "@/modules/types"

/** The tabs of the pane beside the graph, in the order they are offered. */
export const SIDE_TABS: ReadonlyArray<AgentGraphSideTab> = ["chat", "detail"]

/** The views the phone offers in place of two panes, in the order they are offered. */
export const PHONE_VIEWS: ReadonlyArray<AgentGraphPhoneView> = ["checklist", "graph", "chat"]

/** Runs the command an action names. */
export const performAgentGraphAction = (commands: AgentGraphCommands, action: AgentGraphAction): void => {
    switch (action.kind) {
        case "select":
            return commands.select(action.value)
        case "sideTab":
            return commands.sideTab(action.value)
        case "phoneView":
            return commands.phoneView(action.value)
        case "openNode":
            return commands.openNode(action.value)
        case "closeDrawer":
            return commands.closeDrawer()
        case "trace":
            return commands.trace()
        case "untrace":
            return commands.untrace()
    }
}

/** The run a work item left on the graph: its decision, version, outcome and the steps of its trace; null while none is read. */
export const agentGraphRunOf = (
    data: ReturnType<typeof useQueryAgentGraphRunSwr>["data"],
): {
    id: string
    version: number
    outcome: string
    closedAs: string | null
    steps: readonly {
        key: string
        title: string
        kind: "trigger" | "output" | "condition" | "execute"
        step: string
        branchKey: string | null
    }[]
} | null =>
    data === undefined
        ? null
        : {
              id: data.decisionId,
              version: data.version,
              outcome: data.outcome,
              closedAs: data.closedAs,
              steps: parseAgentGraphTrace(data.traceJson) ?? [],
          }

/** The people an approver can be: everyone in the directory who is not disabled. */
export const agentGraphMembersOf = (
    directory: ReturnType<typeof useQueryApproverDirectorySwr>["data"],
): ReadonlyArray<AgentGraphMemberData> | undefined =>
    directory
        ?.filter((member) => member.status !== "disabled")
        .map((member) => ({ id: member.memberId, name: member.name, upToVnd: null }))

/** The graph read, settled only when its payload parsed: a payload that does not parse is an error, not data. */
export const parsedGraphReadOf = (
    graph: ReturnType<typeof useQueryAgentGraphSwr>,
    wire: AgentGraphWire | null | undefined,
): SlotRead<typeof graph.data> => ({
    data: wire === null ? undefined : graph.data,
    error: graph.error ?? (wire === null ? new Error("The agent graph payload is invalid") : undefined),
    isLoading: graph.isLoading,
    isValidating: graph.isValidating,
})

/**
 * The commands of the graph panes: select and open a node, switch the tab, trace a run. The graph is read only (a shop never edits
 * a graph): nothing here writes.
 */
export const agentGraphCommandsOf = (
    read: AgentGraphRead | undefined,
    state: AgentGraphUiView,
): AgentGraphCommands => ({
    select: state.select,
    sideTab: state.sideTab,
    phoneView: state.phoneView,
    openNode: state.openNode,
    closeDrawer: state.closeDrawer,
    untrace: state.untrace,
    trace: () => state.trace(read?.data.runs[0]?.id ?? ""),
})
