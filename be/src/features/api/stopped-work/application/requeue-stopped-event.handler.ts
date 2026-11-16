import { CommandHandler } from "@nestjs/cqrs"
import { StoppedEventsService } from "@modules/domain/job-ops"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { RequeueStoppedEventCommand } from "./requeue-stopped-event.command"

@CommandHandler(RequeueStoppedEventCommand)
/** Sends a buried event back through one domain-service call that checks the caller owns the workspace of the event. */
export class RequeueStoppedEventHandler extends ICQRSHandler<RequeueStoppedEventCommand, boolean> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly stopped: StoppedEventsService,
    ) {
        super(logger)
    }

    protected override process(command: RequeueStoppedEventCommand): Promise<boolean> {
        const { principal, request } = command.params
        return this.stopped.requeue(principal.id, request.workspaceId, request.queue, request.eventId)
    }
}
