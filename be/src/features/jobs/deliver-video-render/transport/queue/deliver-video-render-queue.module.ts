import { Module, type OnModuleInit } from "@nestjs/common"
import { InjectJobProcessorRegistry, type JobProcessorRegistry } from "@modules/platform/jobs"
import { DeliverVideoRenderModule } from "../../deliver-video-render.module"
import { ConfigurableModuleClass } from "./deliver-video-render-queue.module-definition"
import { DeliverVideoRenderProcessor } from "./deliver-video-render.processor"

@Module({ imports: [DeliverVideoRenderModule.register({})], providers: [DeliverVideoRenderProcessor] })
/** The queue transport of the video-render delivery job: registers its processor with the job runner of the api; the render door's intake enqueues it. */
export class DeliverVideoRenderQueueModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
        private readonly processor: DeliverVideoRenderProcessor,
    ) {
        super()
    }

    /** Hands the processor to the registry. */
    onModuleInit(): void {
        this.registry.add(this.processor)
    }
}
