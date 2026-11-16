import { Field, Int, ObjectType } from "@nestjs/graphql"

@ObjectType()
/** What handing a conversation back did. */
export class ConversationReleaseType {
    /** released, nothing_held or not_found. */
    @Field(() => String)
    outcome!: string

    /** How many agents the resume event woke; 0 when none. */
    @Field(() => Int)
    answered!: number
}
