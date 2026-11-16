import { Module } from "@nestjs/common"
import { JobsCli } from "./jobs.cli"
import { ConfigurableModuleClass } from "./jobs.module-definition"
import { ParkedJobCloseService } from "@modules/platform/jobs"
import { CloseJobsCli } from "./subs/close.cli"
import { EventsJobsCli } from "./subs/events.cli"
import { FailedJobsCli } from "./subs/failed.cli"
import { OpenJobsCli } from "./subs/open.cli"
import { RequeueEventJobsCli } from "./subs/requeue-event.cli"
import { RetryJobsCli } from "./subs/retry.cli"
import { RetryFailedJobsCli } from "./subs/retry-failed.cli"
import { StatsJobsCli } from "./subs/stats.cli"
import { TickJobsCli } from "./subs/tick.cli"
import { WatchdogJobsCli } from "./subs/watchdog.cli"

@Module({
    providers: [
        JobsCli,
        StatsJobsCli,
        FailedJobsCli,
        OpenJobsCli,
        RetryJobsCli,
        RetryFailedJobsCli,
        WatchdogJobsCli,
        TickJobsCli,
        CloseJobsCli,
        EventsJobsCli,
        RequeueEventJobsCli,
        ParkedJobCloseService,
    ],
})
/**
 * The jobs group and its ten commands: seven over the job operations capability, `close`, which closes a parked job through the
 * jobs capability's closer on the primary connection (the cli runs no jobs, so it holds the closer itself), and `events` / `requeue-event`,
 * which read and send back what a consumer queue buried (for an event that names no workspace).
 */
export class CliJobsModule extends ConfigurableModuleClass {}
