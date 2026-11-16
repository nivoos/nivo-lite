import { Field, ID, InputType } from "@nestjs/graphql"
import { IsUUID, MaxLength } from "class-validator"

@InputType()
/** The stopped job to hand back to its queue. */
export class ResumeStoppedWorkInput {
    /** The id of the job. */
    @Field(() => ID)
    @IsUUID()
    @MaxLength(36)
    jobId!: string
}
