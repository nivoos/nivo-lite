import { Field, ID, InputType } from "@nestjs/graphql"
import { IsBoolean, IsOptional, IsUUID, MaxLength } from "class-validator"

@InputType()
/** The bounded arguments of cancelAgentRun (end a run in flight). */
export class CancelAgentRunInput {
    /** The run to end. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(64)
    runId!: string

    /** True: the agent words ONE line to the run's customer and it goes through the normal send door; absent or false: nobody is told. */
    @Field(() => Boolean, { nullable: true })
    @IsOptional()
    @IsBoolean()
    tellCustomer?: boolean | null
}

@InputType()
/** The bounded arguments of pauseAgentRun and resumeAgentRun. */
export class AgentRunPauseInput {
    /** The run. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(64)
    runId!: string
}

@InputType()
/** The bounded arguments of endAgentWorkflowRuns. */
export class EndAgentWorkflowRunsInput {
    /** The workflow whose runs in flight end. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(36)
    workflowId!: string
}
