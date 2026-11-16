import { QueryHandler } from "@nestjs/cqrs"
import { AgentRunCancelService, type RunView } from "@modules/domain/agent-runs"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { RunsInFlightQuery } from "./runs-in-flight.query"

@QueryHandler(RunsInFlightQuery)
/** Reads the runs in flight that serve one customer conversation, for any member of the workspace. */
export class RunsInFlightHandler extends ICQRSHandler<RunsInFlightQuery, ReadonlyArray<RunView>> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly door: AgentRunCancelService,
    ) {
        super(logger)
    }

    protected override process(query: RunsInFlightQuery): Promise<ReadonlyArray<RunView>> {
        const { workspaceId, conversationId, contactId } = query.params.request
        return this.door.inFlightOfRoute(query.params.principal.id, workspaceId, conversationId, contactId)
    }
}
