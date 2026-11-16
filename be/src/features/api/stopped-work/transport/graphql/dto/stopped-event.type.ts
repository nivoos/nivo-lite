import { Field, Int, ObjectType } from "@nestjs/graphql"

@ObjectType()
/** One event no reactor could handle, buried in its consumer's dead-letter queue, as the workspace owner reads it. */
export class StoppedEventType {
    /** The consumer queue that gave up on it. */
    @Field()
    queue!: string

    /** The stable id of the event (what the item's card carries after `event:<queue>:`). */
    @Field()
    eventId!: string

    /** The event's name. */
    @Field()
    eventName!: string

    /** Why it was buried: the class of the failure no retry can fix, `max-deliveries` or `malformed`. */
    @Field()
    reason!: string

    /** How many deliveries it had. */
    @Field(() => Int)
    readCount!: number
}
