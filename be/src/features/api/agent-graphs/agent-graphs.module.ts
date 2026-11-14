import { Module } from "@nestjs/common"
import { AgentGraphReadService, AgentModelPickerService } from "@modules/domain/agent-pages"
import { GetAgentGraphHandler } from "./application/get-agent-graph.handler"
import { ListAgentGraphVersionsHandler } from "./application/list-agent-graph-versions.handler"
import { GetAgentGraphRunHandler } from "./application/get-agent-graph-run.handler"
import { ListAgentGraphCoverageHandler } from "./application/list-agent-graph-coverage.handler"
import { GetAiModelPickerHandler } from "./application/get-ai-model-picker.handler"
import { ConfigurableModuleClass } from "./agent-graphs.module-definition"

@Module({
    providers: [
        AgentGraphReadService,
        AgentModelPickerService,
        GetAgentGraphRunHandler,
        ListAgentGraphCoverageHandler,
        GetAgentGraphHandler,
        ListAgentGraphVersionsHandler,
        GetAiModelPickerHandler,
    ],
})
/** The agent graph feature: the editor of the flow each agent follows. */
export class AgentGraphsApiModule extends ConfigurableModuleClass {}
