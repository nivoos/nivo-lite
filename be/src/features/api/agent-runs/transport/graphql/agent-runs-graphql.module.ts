import { Module } from "@nestjs/common"
import { AgentRunsApiModule } from "../../agent-runs.module"
import { ConfigurableModuleClass } from "./agent-runs-graphql.module-definition"
import { CancelAgentRunResolver } from "./cancel-agent-run.resolver"
import { DecideRunStopResolver } from "./decide-run-stop.resolver"
import { RunStopsResolver } from "./run-stops.resolver"
import { RunsInFlightResolver } from "./runs-in-flight.resolver"

@Module({
    imports: [AgentRunsApiModule.register({})],
    providers: [CancelAgentRunResolver, DecideRunStopResolver, RunStopsResolver, RunsInFlightResolver],
})
/** The GraphQL transport of the agent-runs feature. */
export class AgentRunsGraphqlModule extends ConfigurableModuleClass {}
