import { QueryHandler } from "@nestjs/cqrs"
import { StoppedEventsService } from "@modules/domain/job-ops"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import type { ListStoppedEventsResult } from "./list-stopped-events.contracts"
import { ListStoppedEventsQuery } from "./list-stopped-events.query"

@QueryHandler(ListStoppedEventsQuery)
/** Lists the workspace's buried events through one domain-service call that checks the caller owns the workspace. */
export class ListStoppedEventsHandler extends ICQRSHandler<ListStoppedEventsQuery, ListStoppedEventsResult> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly stopped: StoppedEventsService,
    ) {
        super(logger)
    }

    protected override process(query: ListStoppedEventsQuery): Promise<ListStoppedEventsResult> {
        return this.stopped.list(query.params.principal.id, query.params.request.workspaceId)
    }
}
