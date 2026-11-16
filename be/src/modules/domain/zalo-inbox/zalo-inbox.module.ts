import { ZaloDeliveryPolicy } from "./zalo-delivery.policy"
import { Module, type DynamicModule, type OnModuleInit } from "@nestjs/common"
import { PollReceiverRegistryService } from "@modules/domain/provider-registry"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./zalo-inbox.module-definition"
import { ZaloInboxPageReadService } from "./zalo-inbox-page-read.service"
import { ZaloInboxService } from "./zalo-inbox.service"
import { ZaloDeliveryIntakeService } from "./zalo-delivery-intake.service"
import { ZaloInboxTokensService } from "./zalo-inbox-tokens.service"
import { ZaloPollReceiverService } from "./zalo-poll-receiver.service"
import { ZaloSandboxPollReceiverService } from "./zalo-sandbox-poll-receiver.service"

@Module({})
/**
 * The Zalo OA webhook door and its deferred consumer, keeping every event in the connection's account data, with the OA's poll receiver
 * (live and sandbox, registered once at boot: it reads the OA's chats back as the same `zalo_oa.event` rows) and the admission of a new row
 * (registered by the inbox service); the token port the provider reads with is bound here. The poll receiver lives here beside the row's key
 * policy: that policy imports the provider's trigger, so the provider's own module cannot import it back.
 */
export class ZaloInboxModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        private readonly receivers: PollReceiverRegistryService,
        private readonly live: ZaloPollReceiverService,
        private readonly sandbox: ZaloSandboxPollReceiverService,
    ) {
        super()
    }

    /** Hands the poll receiver, live and sandbox, to the engine's registry. */
    onModuleInit(): void {
        this.receivers.register({ live: this.live, sandbox: this.sandbox })
    }

    /** Registers the capability once in the API app. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                ZaloInboxService,
                ZaloDeliveryIntakeService,
                ZaloInboxPageReadService,
                ZaloDeliveryPolicy,
                ZaloInboxTokensService,
                ZaloPollReceiverService,
                ZaloSandboxPollReceiverService,
            ],
            exports: [
                ZaloInboxService,
                ZaloDeliveryIntakeService,
                ZaloInboxPageReadService,
                ZaloDeliveryPolicy,
                ZaloInboxTokensService,
            ],
        }
    }
}
