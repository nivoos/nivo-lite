import type { DynamicModule } from "@nestjs/common"
import { AgentWakesMessageModule } from "@features/reactors/agent-wakes"
import { ConnectionPollReadyMessageModule } from "@features/reactors/connection-poll-ready"
import { SourceFactsMessageModule } from "@features/reactors/source-facts"

/** The event reactors the api runs: each message module subscribes its consumers to their queues on the event bus. */
export const API_REACTORS: Array<DynamicModule> = [
    AgentWakesMessageModule.register({}),
    ConnectionPollReadyMessageModule.register({}),
    SourceFactsMessageModule.register({}),
]
