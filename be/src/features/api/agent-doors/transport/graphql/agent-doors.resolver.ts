import type { CommandBus } from "@nestjs/cqrs"
import { Args, Mutation, Resolver } from "@nestjs/graphql"
import { CurrentPrincipal } from "@modules/domain/identity"
import { WorkspaceId } from "@modules/domain/workspace-members"
import { InjectCommandBus, type Principal } from "@modules/platform/cqrs"
import { ReleaseConversationCommand } from "../../application/release-conversation.command"
import { toConversationReleaseType } from "./agent-doors.mapper"
import { ReleaseConversationInput } from "./dto/agent-doors.input"
import { ConversationReleaseType } from "./dto/agent-doors.type"

@Resolver()
/** GraphQL door of the shop on a conversation: handing a held conversation back to the agents. */
export class AgentDoorsResolver {
    constructor(
        @InjectCommandBus() private readonly commandBus: CommandBus,
    ) {}

    /** Hands a conversation back ("hand back to the agent"): one resume event for its route wakes the graphs on its channel. Owner or manager. */
    @Mutation(() => ConversationReleaseType, { name: "releaseConversation" })
    async releaseConversation(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Args("input") input: ReleaseConversationInput,
    ): Promise<ConversationReleaseType> {
        const release = await this.commandBus.execute(
            new ReleaseConversationCommand({
                request: { workspaceId, conversationId: input.conversationId },
                principal,
            }),
        )
        return toConversationReleaseType(release)
    }
}
