import { Module } from "@nestjs/common"
import { AgentGraphsApiModule } from "../../agent-graphs.module"
import { GetAgentGraphRunResolver } from "./get-agent-graph-run.resolver"
import { ListAgentGraphCoverageResolver } from "./list-agent-graph-coverage.resolver"
import { ConfigurableModuleClass } from "./agent-graphs-graphql.module-definition"
import { GetAgentGraphResolver } from "./get-agent-graph.resolver"
import { ListAgentGraphVersionsResolver } from "./list-agent-graph-versions.resolver"
import { GetAiModelPickerResolver } from "./get-ai-model-picker.resolver"

@Module({
    imports: [AgentGraphsApiModule.register({})],
    providers: [
        GetAgentGraphRunResolver,
        ListAgentGraphCoverageResolver,
        GetAgentGraphResolver,
        ListAgentGraphVersionsResolver,
        GetAiModelPickerResolver,
    ],
})
/** The GraphQL transport of the agent graph editor. */
export class AgentGraphsGraphqlModule extends ConfigurableModuleClass {}
