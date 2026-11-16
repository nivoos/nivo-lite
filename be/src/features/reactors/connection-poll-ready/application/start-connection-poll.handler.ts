import { CommandHandler } from "@nestjs/cqrs"
import { PollSchedulerService } from "@modules/domain/connection-poll"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { StartConnectionPollCommand } from "./start-connection-poll.command"

@CommandHandler(StartConnectionPollCommand)
/**
 * Hands the delivered connection_ready event to the one poll job: an account whose provider has a poll receiver is made ready and hot, so
 * the next tick (within a minute) reads back what reached the provider before the account was connected. Any other account: nothing.
 */
export class StartConnectionPollHandler extends ICQRSHandler<StartConnectionPollCommand, boolean> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly scheduler: PollSchedulerService,
    ) {
        super(logger)
    }

    protected override async process(command: StartConnectionPollCommand): Promise<boolean> {
        return this.scheduler.ready(command.params.request.delivery.event.payload)
    }
}
