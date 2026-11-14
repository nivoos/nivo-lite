import type { QueryBus } from "@nestjs/cqrs"
import { Query, Resolver } from "@nestjs/graphql"
import { CurrentPrincipal } from "@modules/domain/identity"
import { WorkspaceId } from "@modules/domain/workspace-members"
import { InjectQueryBus, type Principal } from "@modules/platform/cqrs"
import { ListStoppedWorkQuery } from "../../application/list-stopped-work.query"
import { StoppedWorkType } from "./dto/stopped-work.type"
import { toStoppedWorkTypes } from "./stopped-work.mapper"

@Resolver()
/** GraphQL door of the stopped jobs of the active workspace. */
export class ListStoppedWorkResolver {
    constructor(@InjectQueryBus() private readonly queryBus: QueryBus) {}

    /** Lists the jobs of the active workspace that stopped for a fix, oldest first; the owner only. */
    @Query(() => [StoppedWorkType], { name: "stoppedWork" })
    async stoppedWork(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
    ): Promise<Array<StoppedWorkType>> {
        const result = await this.queryBus.execute(new ListStoppedWorkQuery({ request: { workspaceId }, principal }))
        return toStoppedWorkTypes(result)
    }
}
