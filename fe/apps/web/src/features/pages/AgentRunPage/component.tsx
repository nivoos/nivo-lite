import { AgentRunPanes } from "@/components/blocks/AgentRunPanes"

/** The type, the instance and the run whose page this is. */
export interface AgentRunPageBaseProps {
    readonly props: {
        readonly module: string | undefined
        readonly installationId: string | undefined
        readonly runId: string | undefined
    }
}

/**
 * Draws the page of one run of an agent: the panes of the run (the head, the map and the selected step).
 */
export const AgentRunPageBase = (props: AgentRunPageBaseProps) => (
    <AgentRunPanes
        module={props.props.module}
        installationId={props.props.installationId}
        runId={props.props.runId}
    />
)
