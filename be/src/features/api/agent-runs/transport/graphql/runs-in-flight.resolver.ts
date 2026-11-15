import type { QueryBus } from "@nestjs/cqrs"
import { Args, Field, ID, InputType, ObjectType, Query, Resolver } from "@nestjs/graphql"
import { IsOptional, IsUUID, MaxLength } from "class-validator"
import type { RunView } from "@modules/domain/agent-runs"
import { CurrentPrincipal } from "@modules/domain/identity"
import { WorkspaceId } from "@modules/domain/workspace-members"
import { InjectQueryBus, type Principal } from "@modules/platform/cqrs"
import { RunsInFlightQuery } from "../../application/runs-in-flight.query"

@InputType()
/** The bounded arguments of agentRunsInFlight. */
export class AgentRunsInFlightInput {
    /** The customer conversation (the route). */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(36)
    conversationId!: string

    /** Its person, when known. */
    @Field(() => ID, { nullable: true })
    @IsOptional()
    @IsUUID()
    @MaxLength(36)
    contactId?: string | null
}

@ObjectType()
/** One run in flight that serves a customer conversation. */
export class AgentRunInFlightType {
    /** The run. */
    @Field(() => ID)
    runId!: string

    /** The agent of the run. */
    @Field(() => ID)
    agentId!: string

    /** running, waiting or paused (a person paused it). */
    @Field(() => String)
    status!: string
}

const statusOf = (run: RunView): string => (run.status === "parked" ? "paused" : run.status)

@Resolver()
/** GraphQL door of agentRunsInFlight. */
export class RunsInFlightResolver {
    constructor(@InjectQueryBus() private readonly queryBus: QueryBus) {}

    /** The runs in flight that serve one customer conversation (its route or its person), oldest first: what End / Pause act on. */
    @Query(() => [AgentRunInFlightType], { name: "agentRunsInFlight" })
    async agentRunsInFlight(
        @CurrentPrincipal() principal: Principal,
        @WorkspaceId() workspaceId: string,
        @Args("input") input: AgentRunsInFlightInput,
    ): Promise<ReadonlyArray<AgentRunInFlightType>> {
        const runs: ReadonlyArray<RunView> = await this.queryBus.execute(
            new RunsInFlightQuery({
                request: { workspaceId, conversationId: input.conversationId, contactId: input.contactId ?? null },
                principal,
            }),
        )
        return runs.map((run) => ({ runId: run.id, agentId: run.agentId, status: statusOf(run) }))
    }
}
