import { Module, type OnModuleInit } from "@nestjs/common"
import { InjectJobProcessorRegistry, type JobProcessorRegistry } from "@modules/platform/jobs"
import { DeliverRecordEventModule } from "../../deliver-record-event.module"
import { ConfigurableModuleClass } from "./deliver-record-event-queue.module-definition"
import { DeliverRecordEventProcessor } from "./deliver-record-event.processor"

@Module({ imports: [DeliverRecordEventModule.register({})], providers: [DeliverRecordEventProcessor] })
/** The queue transport of the record-event job: registers its processor with the job runner of the api; a record write enqueues it. */
export class DeliverRecordEventQueueModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
        private readonly processor: DeliverRecordEventProcessor,
    ) {
        super()
    }

    /** Hands the processor to the registry (the derived declarations register on their first delivery; only the api delivers). */
    onModuleInit(): void {
        this.registry.add(this.processor)
    }
}
