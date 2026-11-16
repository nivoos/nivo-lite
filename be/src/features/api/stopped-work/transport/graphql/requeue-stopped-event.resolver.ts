import type { CommandBus } from "@nestjs/cqrs"
import { Args, Mutation, Resolver } from "@nestjs/graphql"
import { CurrentPrincipal } from "@modules/domain/identity"
import { WorkspaceId } from "@modules/domain/workspace-members"
import { InjectCommandBus, type Principal } from "@modules/platform/cqrs"
import { RequeueStoppedEventCommand } from "../../application/requeue-stopped-event.command"
import { RequeueStoppedEventInput } from "./dto/requeue-stopped-event.input"

@Resolver()
/** GraphQL door of sending a buried event back to its consumer. */
export class RequeueStoppedEventResolver {
    constructor(@InjectCommandBus() private readonly commandBus: CommandBus) {}

    /** Sends a buried event of the active workspace back ("requeue"); false when it is not a buried event of this workspace. The owner only. */
    @Mutation(() => Boolean, { name: "requeueStoppedEvent" })
    requeueStoppedEvent(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Args("input") input: RequeueStoppedEventInput,
    ): Promise<boolean> {
        return this.commandBus.execute(
            new RequeueStoppedEventCommand({ request: { workspaceId, queue: input.queue, eventId: input.eventId }, principal }),
        )
    }
}
