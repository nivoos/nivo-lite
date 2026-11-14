import { Field, Int, ObjectType } from "@nestjs/graphql"

@ObjectType()
/** NIVO's "a job stopped for a fix" card (`job.parked`): codes and ids only, the web words them; resume and close are the stopped-work door. */
export class ChatJobParkedCardType {
    /** The parked job (its id): what `resumeStoppedWork` and `closeStoppedWork` take. */
    @Field(() => String)
    jobId!: string

    /** The job's name, a stable key (the web words it through `chat.jobParked.job.<name>`, the raw name when it has no words). */
    @Field(() => String)
    job!: string

    /** Why it will not run on its own: `transient` (the tries ran out), `input`, `code` or `config`. */
    @Field(() => String)
    failureClass!: string

    /** The failure code. */
    @Field(() => String)
    reason!: string

    /** The park episode: how many times a person resumed the job before this park. */
    @Field(() => Int)
    episode!: number

    /** When it parked, ISO. */
    @Field(() => String)
    since!: string
}
