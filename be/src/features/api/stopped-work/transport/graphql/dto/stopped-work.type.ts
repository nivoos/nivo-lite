import { Field, ID, Int, ObjectType } from "@nestjs/graphql"
import { StoppedWorkFailureClass } from "./stopped-work-failure-class.type"

@ObjectType()
/** One stopped job of the workspace, as its owner reads it. */
export class StoppedWorkType {
    /** The job row. */
    @Field(() => ID)
    jobId!: string

    /** The job's name (the web words it through its catalogue). */
    @Field()
    job!: string

    /** Why it will not run on its own. */
    @Field(() => StoppedWorkFailureClass)
    failureClass!: (typeof StoppedWorkFailureClass)[keyof typeof StoppedWorkFailureClass]

    /** The failure code. */
    @Field()
    reason!: string

    /** When it stopped, ISO 8601. */
    @Field()
    parkedAt!: string

    /** How many times a person handed it back. */
    @Field(() => Int)
    resumeCount!: number
}
