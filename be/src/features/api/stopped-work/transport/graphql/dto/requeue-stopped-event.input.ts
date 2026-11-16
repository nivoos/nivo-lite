import { Field, InputType } from "@nestjs/graphql"
import { IsNotEmpty, IsString, MaxLength } from "class-validator"

@InputType()
/** The buried event to send back to its consumer. */
export class RequeueStoppedEventInput {
    /** The consumer queue that buried it. */
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    queue!: string

    /** The stable id of the event. */
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(256)
    eventId!: string
}
