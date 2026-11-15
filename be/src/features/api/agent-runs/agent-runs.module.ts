import { Module } from "@nestjs/common"
import { CancelAgentRunHandler, EndWorkflowRunsHandler, PauseAgentRunHandler } from "./application/cancel-agent-run.handler"
import { DecideRunStopHandler } from "./application/decide-run-stop.handler"
import { ResumeAgentRunHandler } from "./application/resume-agent-run.handler"
import { RunStopsHandler } from "./application/run-stops.handler"
import { RunsInFlightHandler } from "./application/runs-in-flight.handler"
import { RunStopDecisionsService, RunStopsPageService } from "@modules/domain/agent-pages"
import { ConfigurableModuleClass } from "./agent-runs.module-definition"

@Module({
    providers: [
        RunStopDecisionsService,
        RunStopsPageService,
        ResumeAgentRunHandler,
        CancelAgentRunHandler,
        PauseAgentRunHandler,
        EndWorkflowRunsHandler,
        DecideRunStopHandler,
        RunStopsHandler,
        RunsInFlightHandler,
    ],
})
/** The agent-runs feature: the owner's operations on the durable runs of the agents, and the decisions on the stops of thread runs. */
export class AgentRunsApiModule extends ConfigurableModuleClass {}
