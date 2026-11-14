import type { CommandBus } from "@nestjs/cqrs"
import { Args, Mutation, Resolver } from "@nestjs/graphql"
import { CurrentPrincipal } from "@modules/domain/identity"
import { WorkspaceId } from "@modules/domain/workspace-members"
import { InjectCommandBus, type Principal } from "@modules/platform/cqrs"
import { ResumeStoppedWorkCommand } from "../../application/resume-stopped-work.command"
import { ResumeStoppedWorkInput } from "./dto/resume-stopped-work.input"

@Resolver()
/** GraphQL door of handing a stopped job back to its queue. */
export class ResumeStoppedWorkResolver {
    constructor(@InjectCommandBus() private readonly commandBus: CommandBus) {}

    /** Hands a stopped job of the active workspace back ("resume now"); false when it is not a stopped job of this workspace. The owner only. */
    @Mutation(() => Boolean, { name: "resumeStoppedWork" })
    resumeStoppedWork(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Args("input") input: ResumeStoppedWorkInput,
    ): Promise<boolean> {
        return this.commandBus.execute(
            new ResumeStoppedWorkCommand({ request: { workspaceId, jobId: input.jobId }, principal }),
        )
    }
}
