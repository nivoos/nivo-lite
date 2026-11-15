import { CommandHandler } from "@nestjs/cqrs"
import {
    AgentRunCancelService,
    type OwnerEndAnswer,
    type OwnerPauseAnswer,
    type WorkflowRunsEnded,
} from "@modules/domain/agent-runs"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { CancelAgentRunCommand, EndWorkflowRunsCommand, PauseAgentRunCommand } from "./cancel-agent-run.command"

@CommandHandler(CancelAgentRunCommand)
/** Ends a run through the run door of the agent runs (owner or manager). */
export class CancelAgentRunHandler extends ICQRSHandler<CancelAgentRunCommand, OwnerEndAnswer> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly door: AgentRunCancelService,
    ) {
        super(logger)
    }

    protected override process(command: CancelAgentRunCommand): Promise<OwnerEndAnswer> {
        return this.door.cancel({ principalId: command.params.principal.id, ...command.params.request })
    }
}

@CommandHandler(PauseAgentRunCommand)
/** Pauses a run through the run door (owner or manager). */
export class PauseAgentRunHandler extends ICQRSHandler<PauseAgentRunCommand, OwnerPauseAnswer> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly door: AgentRunCancelService,
    ) {
        super(logger)
    }

    protected override process(command: PauseAgentRunCommand): Promise<OwnerPauseAnswer> {
        return this.door.pause({ principalId: command.params.principal.id, ...command.params.request })
    }
}

@CommandHandler(EndWorkflowRunsCommand)
/** Ends every run of a workflow in flight through the run door (owner or manager). */
export class EndWorkflowRunsHandler extends ICQRSHandler<EndWorkflowRunsCommand, WorkflowRunsEnded> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly door: AgentRunCancelService,
    ) {
        super(logger)
    }

    protected override process(command: EndWorkflowRunsCommand): Promise<WorkflowRunsEnded> {
        return this.door.endAllOfWorkflow({ principalId: command.params.principal.id, ...command.params.request })
    }
}
