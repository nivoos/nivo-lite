import { CommandHandler } from "@nestjs/cqrs"
import { AgentWorkflowsAdminService, type WorkflowVersionWire } from "@modules/domain/agent-graphs"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { SetAgentNodeSettingsCommand } from "./set-agent-node-settings.command"

@CommandHandler(SetAgentNodeSettingsCommand)
/**
 * Sets one node step's settings for the owner (the node settings of `node-settings.policy`: its mode and the accounts it uses). The admin
 * service checks the seat (owner only), that the workflow is the agent's, judges every setting and writes the new version through the
 * judged road.
 */
export class SetAgentNodeSettingsHandler extends ICQRSHandler<SetAgentNodeSettingsCommand, WorkflowVersionWire> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly admin: AgentWorkflowsAdminService,
    ) {
        super(logger)
    }

    protected override process(command: SetAgentNodeSettingsCommand): Promise<WorkflowVersionWire> {
        const { request, principal } = command.params
        return this.admin.setNodeSettings({ workspaceId: request.workspaceId, principalId: principal.id }, request)
    }
}
