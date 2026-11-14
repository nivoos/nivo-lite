import { Field, ID, InputType, Int } from "@nestjs/graphql"
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator"

@InputType()
/** What setAgentNodeSettings takes: one node step of one workflow of the installation's agent, and the settings to change. */
export class SetAgentNodeSettingsInput {
    /** The installation whose agent holds the workflow. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(36)
    installationId!: string

    /** The workflow. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(36)
    workflowId!: string

    /** The node, by its key in the workflow's running graph. */
    @Field(() => String)
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    nodeKey!: string

    /** `auto` (the node's calls run) or `ask` (each write waits for a person's approval); absent: the mode is left. */
    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsIn(["auto", "ask"])
    mode?: string | null

    /** The agent's attached accounts the step uses, in try order; an empty list goes back to the default pick; absent: left. */
    @Field(() => [ID], { nullable: true })
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(20)
    @IsUUID("all", { each: true })
    accountIds?: ReadonlyArray<string> | null

    /** The newest version number the caller read; a newer one refuses the change. */
    @Field(() => Int, { nullable: true })
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(100000)
    expectedLatest?: number | null
}
