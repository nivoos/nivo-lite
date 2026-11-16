import { Field, Int, ObjectType } from "@nestjs/graphql"

@ObjectType()
/** What ending a run did. */
export class AgentRunCancelType {
    /** "ended", or why it was not: already_ended (it had ended before, whatever ended it) or not_found. */
    @Field(() => String)
    kind!: string

    /** "effects_kept" when the run ended now: whatever its steps already sent or did is not undone; null otherwise. */
    @Field(() => String, { nullable: true })
    note!: string | null

    /** How many runs it had called that were still in flight and ended with it. */
    @Field(() => Int)
    children!: number
}

@ObjectType()
/** What pausing or resuming a run did. */
export class AgentRunPauseType {
    /** "paused" / "resumed", or why not: already_paused, not_paused, already_ended, not_found. */
    @Field(() => String)
    kind!: string
}

@ObjectType()
/** What ending every run of a workflow in flight did. */
export class AgentWorkflowRunsEndedType {
    /** How many runs ended now. */
    @Field(() => Int)
    ended!: number
}
