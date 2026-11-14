import { QueryHandler } from "@nestjs/cqrs"
import { StoppedWorkService } from "@modules/domain/job-ops"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import type { ListStoppedWorkResult } from "./list-stopped-work.contracts"
import { ListStoppedWorkQuery } from "./list-stopped-work.query"

@QueryHandler(ListStoppedWorkQuery)
/** Lists the workspace's stopped jobs through one domain-service call that checks the caller owns the workspace. */
export class ListStoppedWorkHandler extends ICQRSHandler<ListStoppedWorkQuery, ListStoppedWorkResult> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly stopped: StoppedWorkService,
    ) {
        super(logger)
    }

    protected override process(query: ListStoppedWorkQuery): Promise<ListStoppedWorkResult> {
        return this.stopped.list(query.params.principal.id, query.params.request.workspaceId)
    }
}
