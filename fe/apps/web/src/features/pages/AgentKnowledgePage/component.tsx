import { AgentKnowledge } from "@/components/blocks/AgentKnowledge"

/** What the tab hands the knowledge block: the workspace, the type and the instance of the url. */
export interface AgentKnowledgeProps {
    readonly workspaceId: string | undefined
    readonly module: string | undefined
    readonly installationId: string | undefined
}

/** The workspace, type and instance the knowledge tab draws. */
export interface AgentKnowledgePageBaseProps {
    readonly props: AgentKnowledgeProps
}

/** Draws the knowledge tab of an agent: the block that fills it. */
export const AgentKnowledgePageBase = (props: AgentKnowledgePageBaseProps) => <AgentKnowledge {...props.props} />
