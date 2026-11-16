import { AgentGraphVersionEntity } from "./agent-graph-version.entity"
import { AgentGraphEntity } from "./agent-graph.entity"
import { AgentWorkflowVersionEntity } from "./agent-workflow-version.entity"
import { AgentWorkflowEntity } from "./agent-workflow.entity"
import { WorkflowTriggerPickEntity } from "./workflow-trigger-pick.entity"

export {
    AgentGraphEntity,
    AgentGraphVersionEntity,
    AgentWorkflowEntity,
    AgentWorkflowVersionEntity,
    WorkflowTriggerPickEntity,
}

/** Every entity the agent-graphs capability owns, collected by the database connection. */
export const agentGraphsEntities: readonly [
    typeof WorkflowTriggerPickEntity,
    typeof AgentGraphEntity,
    typeof AgentGraphVersionEntity,
    typeof AgentWorkflowEntity,
    typeof AgentWorkflowVersionEntity,
] = [
    WorkflowTriggerPickEntity,
    AgentGraphEntity,
    AgentGraphVersionEntity,
    AgentWorkflowEntity,
    AgentWorkflowVersionEntity,
] as const
