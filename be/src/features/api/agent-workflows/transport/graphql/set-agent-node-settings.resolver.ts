import type { CommandBus } from "@nestjs/cqrs"
import { Args, Mutation, Resolver } from "@nestjs/graphql"
import { CurrentPrincipal } from "@modules/domain/identity"
import { WorkspaceId } from "@modules/domain/workspace-members"
import { InjectCommandBus, type Principal } from "@modules/platform/cqrs"
import { SetAgentNodeSettingsCommand } from "../../application/set-agent-node-settings.command"
import { AgentWorkflowVersionType } from "./dto/agent-workflow-version.type"
import { SetAgentNodeSettingsInput } from "./dto/set-agent-node-settings.input"

@Resolver()
/** GraphQL door of setAgentNodeSettings: the owner sets one node step's mode and / or the accounts it uses. */
export class SetAgentNodeSettingsResolver {
    constructor(@InjectCommandBus() private readonly commandBus: CommandBus) {}

    /** The setAgentNodeSettings mutation: the new version of the workflow (or the running one when nothing changes). */
    @Mutation(() => AgentWorkflowVersionType, { name: "setAgentNodeSettings" })
    setAgentNodeSettings(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Args("input") input: SetAgentNodeSettingsInput,
    ): Promise<AgentWorkflowVersionType> {
        return this.commandBus.execute(new SetAgentNodeSettingsCommand({ request: { workspaceId, ...input }, principal }))
    }
}
