import { Field, ID, InputType } from "@nestjs/graphql"
import { IsString, IsUUID, MaxLength, MinLength } from "class-validator"

@InputType()
/** The stopped job to close for good, with the person's reason. */
export class CloseStoppedWorkInput {
    /** The id of the job. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(36)
    jobId!: string

    /** Why it is closed. */
    @Field()
    @IsString()
    @MinLength(1)
    @MaxLength(500)
    reason!: string
}
