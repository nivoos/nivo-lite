import { Module, type OnModuleInit } from "@nestjs/common"
import { InjectJobProcessorRegistry, type JobProcessorRegistry } from "@modules/platform/jobs"
import { RouteTeamChatMessageModule } from "../../route-team-chat-message.module"
import { ConfigurableModuleClass } from "./route-team-chat-message-queue.module-definition"
import { RouteTeamChatMessageProcessor } from "./route-team-chat-message.processor"

@Module({ imports: [RouteTeamChatMessageModule.register({})], providers: [RouteTeamChatMessageProcessor] })
/** The queue transport of the route job: registers its processor with the job runner of the api; a stored message of a person enqueues it. */
export class RouteTeamChatMessageQueueModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        @InjectJobProcessorRegistry() private readonly registry: JobProcessorRegistry,
        private readonly processor: RouteTeamChatMessageProcessor,
    ) {
        super()
    }

    /** Hands the processor to the registry (only the api routes). */
    onModuleInit(): void {
        this.registry.add(this.processor)
    }
}
