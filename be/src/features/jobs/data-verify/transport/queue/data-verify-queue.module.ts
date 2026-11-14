import { Module, type OnModuleInit } from "@nestjs/common"
import { InjectJobProcessorRegistry, type JobProcessorRegistry } from "@modules/platform/jobs"
import { DataVerifyModule } from "../../data-verify.module"
import { ConfigurableModuleClass } from "./data-verify-queue.module-definition"
import { DataVerifyProcessor } from "./data-verify.processor"

@Module({ imports: [DataVerifyModule.register({})], providers: [DataVerifyProcessor] })
/** The queue transport of the data-verify job: registers its processor with the job runner. Not in the API composition until the real drivers are bound. */
export class DataVerifyQueueModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
        private readonly processor: DataVerifyProcessor,
    ) {
        super()
    }

    /** Hands the processor to the registry. */
    onModuleInit(): void {
        this.registry.add(this.processor)
    }
}
