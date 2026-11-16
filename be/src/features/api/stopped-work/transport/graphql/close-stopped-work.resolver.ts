import type { CommandBus } from "@nestjs/cqrs"
import { Args, Mutation, Resolver } from "@nestjs/graphql"
import { CurrentPrincipal } from "@modules/domain/identity"
import { WorkspaceId } from "@modules/domain/workspace-members"
import { InjectCommandBus, type Principal } from "@modules/platform/cqrs"
import { CloseStoppedWorkCommand } from "../../application/close-stopped-work.command"
import { CloseStoppedWorkInput } from "./dto/close-stopped-work.input"

@Resolver()
/** GraphQL door of closing a stopped job for good. */
export class CloseStoppedWorkResolver {
    constructor(@InjectCommandBus() private readonly commandBus: CommandBus) {}

    /** Closes a stopped job of the active workspace for good, with the person's reason; a typed refusal (not found, already closed, not stopped) otherwise. The owner only. */
    @Mutation(() => Boolean, { name: "closeStoppedWork" })
    closeStoppedWork(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Args("input") input: CloseStoppedWorkInput,
    ): Promise<boolean> {
        return this.commandBus.execute(
            new CloseStoppedWorkCommand({ request: { workspaceId, jobId: input.jobId, reason: input.reason }, principal }),
        )
    }
}
