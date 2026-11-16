import { Module, type OnModuleInit } from "@nestjs/common"
import { InjectJobProcessorRegistry, type JobProcessorRegistry } from "@modules/platform/jobs"
import { DeliverWebsiteFormModule } from "../../deliver-website-form.module"
import { ConfigurableModuleClass } from "./deliver-website-form-queue.module-definition"
import { DeliverWebsiteFormProcessor } from "./deliver-website-form.processor"

@Module({ imports: [DeliverWebsiteFormModule.register({})], providers: [DeliverWebsiteFormProcessor] })
/** The queue transport of the website-form job: registers its processor with the job runner of the api; an accepted form enqueues it. */
export class DeliverWebsiteFormQueueModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
        private readonly processor: DeliverWebsiteFormProcessor,
    ) {
        super()
    }

    /** Hands the processor to the registry (the form's trigger is registered by the website intake module; only the api delivers it). */
    onModuleInit(): void {
        this.registry.add(this.processor)
    }
}
