import { AgentGraphDetail } from "@/components/branches/AgentGraphDetail"
import { AgentGraphRun } from "@/components/branches/AgentGraphRun"
import type { AgentGraphAction, AgentGraphPanelView } from "@/modules/types"

/** The graph view and the commands of the panes. */
interface AgentGraphInspectorProps {
    readonly view: AgentGraphPanelView
    readonly isLoading: boolean
    readonly onAction: (action: AgentGraphAction) => void
}

/** What the pane beside the graph shows for a tab that is not the chat: the run being traced, or the seven answers of the selected node (read only). */
export const AgentGraphInspector = (props: AgentGraphInspectorProps) => {
    const { view, onAction } = props
    if (view.inspector === "run" && view.run !== null) {
        return (
            <AgentGraphRun view={view.run} isLoading={props.isLoading} onBack={() => onAction({ kind: "untrace" })} />
        )
    }
    return (
        <AgentGraphDetail view={view.detail} isLoading={props.isLoading} onRuns={() => onAction({ kind: "trace" })} />
    )
}
