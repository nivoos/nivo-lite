import { Module, type OnModuleInit } from "@nestjs/common"
import { InjectJobProcessorRegistry, type JobProcessorRegistry } from "@modules/platform/jobs"
import { RefreshZaloConnectionModule } from "../../refresh-zalo-connection.module"
import { ConfigurableModuleClass } from "./refresh-zalo-connection-queue.module-definition"
import { RefreshZaloConnectionProcessor } from "./refresh-zalo-connection.processor"

@Module({ imports: [RefreshZaloConnectionModule.register({})], providers: [RefreshZaloConnectionProcessor] })
/** The queue transport of the refresh-zalo-connection job: registers its processor with the job runner; the refresh tick writes its jobs. */
export class RefreshZaloConnectionQueueModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
        private readonly processor: RefreshZaloConnectionProcessor,
    ) {
        super()
    }

    /** Hands the processor to the registry. */
    onModuleInit(): void {
        this.registry.add(this.processor)
    }
}
