import { Module, type OnModuleInit } from "@nestjs/common"
import {
    CONNECTION_READY_CONNECTION_POLL_TOPIC_QUEUE,
    InjectEventConsumerRegistry,
    type EventConsumerRegistry,
} from "@modules/platform/event-bus"
import { ConnectionPollReadyReactorModule } from "../../connection-poll-ready.module"
import { ConfigurableModuleClass } from "./connection-poll-ready-message.module-definition"
import { ConnectionReadyConsumer } from "./connection-ready.consumer"

@Module({ imports: [ConnectionPollReadyReactorModule.register({})], providers: [ConnectionReadyConsumer] })
/** The message transport of the connection-poll-ready reactor: subscribes its consumer to its queue; the api app composes it. */
export class ConnectionPollReadyMessageModule extends ConfigurableModuleClass implements OnModuleInit {
    constructor(
        @InjectEventConsumerRegistry() private readonly consumers: EventConsumerRegistry,
        private readonly connectionReadyConsumer: ConnectionReadyConsumer,
    ) {
        super()
    }

    /** The subscriptions are static: one literal queue constant per consumer. */
    onModuleInit(): void {
        this.consumers.subscribe(CONNECTION_READY_CONNECTION_POLL_TOPIC_QUEUE, this.connectionReadyConsumer)
    }
}
