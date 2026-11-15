import type { CommandBus } from "@nestjs/cqrs"
import { Args, Mutation, Resolver } from "@nestjs/graphql"
import { CurrentPrincipal } from "@modules/domain/identity"
import { WorkspaceId } from "@modules/domain/workspace-members"
import { InjectCommandBus, type Principal } from "@modules/platform/cqrs"
import { CancelAgentRunCommand, EndWorkflowRunsCommand, PauseAgentRunCommand } from "../../application/cancel-agent-run.command"
import { ResumeAgentRunCommand } from "../../application/resume-agent-run.command"
import { AgentRunCancelType, AgentRunPauseType, AgentWorkflowRunsEndedType } from "./dto/agent-run-cancel.type"
import { AgentRunPauseInput, CancelAgentRunInput, EndAgentWorkflowRunsInput } from "./dto/cancel-agent-run.input"

@Resolver()
/** GraphQL doors of the run door: end, pause and resume one run, end every run of a workflow in flight. Owner or manager only. */
export class CancelAgentRunResolver {
    constructor(@InjectCommandBus() private readonly commandBus: CommandBus) {}

    /**
     * ENDS a run of the workspace in flight, whatever its state (running a step, waiting for an event, a person, a timer, a retry, an
     * approval, paused, with a child in flight): no further step runs, its stops and their cards close in place, what waited behind it
     * goes to the next run; what it already sent is not undone. The customer is told nothing unless `tellCustomer`.
     */
    @Mutation(() => AgentRunCancelType, { name: "cancelAgentRun" })
    async cancelAgentRun(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Args("input") input: CancelAgentRunInput,
    ): Promise<AgentRunCancelType> {
        return this.commandBus.execute(
            new CancelAgentRunCommand({
                request: { workspaceId, runId: input.runId, tellCustomer: input.tellCustomer === true },
                principal,
            }),
        )
    }

    /** PAUSES a run in flight: no further step and no wake until resumed; it keeps its customer and what comes for it is kept for it. */
    @Mutation(() => AgentRunPauseType, { name: "pauseAgentRun" })
    async pauseAgentRun(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Args("input") input: AgentRunPauseInput,
    ): Promise<AgentRunPauseType> {
        return this.commandBus.execute(new PauseAgentRunCommand({ request: { workspaceId, runId: input.runId }, principal }))
    }

    /** RESUMES a run a person paused: what came while it was paused runs in the order it came. */
    @Mutation(() => AgentRunPauseType, { name: "resumeAgentRun" })
    async resumeAgentRun(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Args("input") input: AgentRunPauseInput,
    ): Promise<AgentRunPauseType> {
        return this.commandBus.execute(new ResumeAgentRunCommand({ request: { workspaceId, runId: input.runId }, principal }))
    }

    /** Ends every run of the workflow in flight, each through the same end; the workflow keeps taking new work. */
    @Mutation(() => AgentWorkflowRunsEndedType, { name: "endAgentWorkflowRuns" })
    async endAgentWorkflowRuns(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Args("input") input: EndAgentWorkflowRunsInput,
    ): Promise<AgentWorkflowRunsEndedType> {
        return this.commandBus.execute(
            new EndWorkflowRunsCommand({ request: { workspaceId, workflowId: input.workflowId }, principal }),
        )
    }
}
