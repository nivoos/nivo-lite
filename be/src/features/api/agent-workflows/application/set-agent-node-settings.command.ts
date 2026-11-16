import { Command } from "@nestjs/cqrs"
import type { WorkflowVersionWire } from "@modules/domain/agent-graphs"
import type { ExecuteParams } from "@modules/platform/cqrs"
import type { SetAgentNodeSettingsRequest } from "./set-agent-node-settings.contracts"

/** Sets one node step's settings (its mode, the accounts it uses): a new version of the workflow's graph copy. */
export class SetAgentNodeSettingsCommand extends Command<WorkflowVersionWire> {
    constructor(readonly params: ExecuteParams<SetAgentNodeSettingsRequest>) {
        super()
    }
}
