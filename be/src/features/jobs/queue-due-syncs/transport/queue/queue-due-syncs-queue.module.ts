import { Module, type OnModuleInit } from "@nestjs/common"
import { InjectJobProcessorRegistry, type JobProcessorRegistry } from "@modules/platform/jobs"
import { QueueDueSyncsModule } from "../../queue-due-syncs.module"
import { ConfigurableModuleClass } from "./queue-due-syncs-queue.module-definition"
import { QueueDueSyncsProcessor } from "./queue-due-syncs.processor"

@Module({ imports: [QueueDueSyncsModule.register({})], providers: [QueueDueSyncsProcessor] })
/** The queue transport of the queue-due-syncs job: registers its processor with the job runner; the app registers the scheduler that ticks it. */
export class QueueDueSyncsQueueModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
        private readonly processor: QueueDueSyncsProcessor,
    ) {
        super()
    }

    /** Hands the processor to the registry. */
    onModuleInit(): void {
        this.registry.add(this.processor)
    }
}
