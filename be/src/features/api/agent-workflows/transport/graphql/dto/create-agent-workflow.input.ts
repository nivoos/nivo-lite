import { Field, ID, InputType, Int } from "@nestjs/graphql"
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator"

@InputType()
/** What createAgentWorkflow takes. */
export class CreateAgentWorkflowInput {
    /** The installation whose agent holds the workflows. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(36)
    installationId!: string

    /** The template to copy: a workflow is always a template's copy. */
    @Field(() => String)
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    templateId!: string

    /** The template version to copy; the newest when absent. */
    @Field(() => Int, { nullable: true })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(100000)
    templateVersion?: number | null

    /** The language of the names; Vietnamese unless en is named. */
    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsIn(["vi", "en"])
    @MaxLength(2)
    locale?: string | null
}
