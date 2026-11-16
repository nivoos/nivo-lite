import { Module, type DynamicModule } from "@nestjs/common"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./connection-poll.module-definition"
import { POLL_EXPORTED, pollProvidersOf } from "./poll-providers.policy"

@Module({})
/**
 * THE ONE POLL JOB (owner R95): the per-account schedule, the limiter, the breaker and the tick that reads what is due through each provider's
 * POLL RECEIVER (`PollReceiverRegistryService`) and keeps it through the one account_data intake (`PollReceiptsService`: a new row is admitted,
 * an existing one is nothing); the pass at process start (`PollBootPassService`). Other modules call `PollScheduleService.markHot`,
 * `recordWebhook` and `PollSchedulerService.ready`.
 */
export class ConnectionPollModule extends ConfigurableModuleClass {
    /** Registers the capability once in the API app. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [...(base.providers ?? []), ...pollProvidersOf(options)],
            exports: [...POLL_EXPORTED],
        }
    }
}
