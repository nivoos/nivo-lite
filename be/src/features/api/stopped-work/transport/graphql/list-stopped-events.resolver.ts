import type { QueryBus } from "@nestjs/cqrs"
import { Query, Resolver } from "@nestjs/graphql"
import { CurrentPrincipal } from "@modules/domain/identity"
import { WorkspaceId } from "@modules/domain/workspace-members"
import { InjectQueryBus, type Principal } from "@modules/platform/cqrs"
import { ListStoppedEventsQuery } from "../../application/list-stopped-events.query"
import { StoppedEventType } from "./dto/stopped-event.type"
import { toStoppedEventTypes } from "./stopped-event.mapper"

@Resolver()
/** GraphQL door of the buried events of the active workspace. */
export class ListStoppedEventsResolver {
    constructor(@InjectQueryBus() private readonly queryBus: QueryBus) {}

    /** Lists the events of the active workspace that no reactor could handle and were buried; the owner only. */
    @Query(() => [StoppedEventType], { name: "stoppedEvents" })
    async stoppedEvents(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
    ): Promise<Array<StoppedEventType>> {
        const result = await this.queryBus.execute(new ListStoppedEventsQuery({ request: { workspaceId }, principal }))
        return toStoppedEventTypes(result)
    }
}
