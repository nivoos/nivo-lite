import { Injectable, type OnApplicationBootstrap } from "@nestjs/common"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { ConnectionPollLogEvent } from "./connection-poll.log-events"
import { PollScheduleService } from "./poll-schedule.service"

@Injectable()
/**
 * The pass of the one poll job right after the process starts (owner R95): a downtime is a gap every webhook may have lost events in, so
 * every scheduled account is made due at once and the next ticks read them back. A failure to mark is logged and the ordinary cadence
 * still reads every account later: the boot never stops for it.
 */
export class PollBootPassService implements OnApplicationBootstrap {
    constructor(
        private readonly schedule: PollScheduleService,
        @InjectLogger() private readonly logger: Logger,
    ) {}

    /** Makes every scheduled account due now. */
    async onApplicationBootstrap(): Promise<void> {
        await this.schedule.dueNow().catch((cause: unknown) => {
            this.logger.error(ConnectionPollLogEvent.BootPassFailed, cause, {})
        })
    }
}
