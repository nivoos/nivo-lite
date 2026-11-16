import { Query } from "@nestjs/cqrs"
import type { WorkflowSettingsDetailWire } from "@modules/domain/agent-graphs"
import type { ExecuteParams } from "@modules/platform/cqrs"
import type { AgentWorkflowRequest } from "./agent-workflow.contracts"

/** Reads one workflow with the graph that runs, its version history, how it differs from its template and every step's node settings. */
export class AgentWorkflowQuery extends Query<WorkflowSettingsDetailWire> {
    constructor(readonly params: ExecuteParams<AgentWorkflowRequest>) {
        super()
    }
}
