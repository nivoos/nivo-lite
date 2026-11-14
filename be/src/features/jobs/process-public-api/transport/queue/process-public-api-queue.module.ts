import { Module, type OnModuleInit } from "@nestjs/common"
import { InjectJobProcessorRegistry, type JobProcessorRegistry } from "@modules/platform/jobs"
import { ProcessPublicApiJobModule } from "../../process-public-api.module"
import { ConfigurableModuleClass } from "./process-public-api-queue.module-definition"
import { PublicApiRequestProcessor, LegacyPublicApiRequestProcessor, SendPublicMessageProcessor } from "./process-public-api.processor"

@Module({
    imports: [ProcessPublicApiJobModule.register({})],
    providers: [PublicApiRequestProcessor, LegacyPublicApiRequestProcessor, SendPublicMessageProcessor],
})
/** Registers the public API queue with the existing fenced runner and its retry transport. */
export class ProcessPublicApiQueueModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
        private readonly processor: PublicApiRequestProcessor,
        private readonly legacyProcessor: LegacyPublicApiRequestProcessor,
        private readonly sendProcessor: SendPublicMessageProcessor,
    ) {
        super()
    }

    /** Subscribes the current named request, the supported historical queue job name and the send of a reply. */
    onModuleInit(): void {
        this.registry.add(this.processor)
        this.registry.add(this.legacyProcessor)
        this.registry.add(this.sendProcessor)
    }
}
