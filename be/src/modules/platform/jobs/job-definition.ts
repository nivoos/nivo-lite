import type { JobLadderName } from "./job-ladders.policy"
import type { JobProgressDeclaration } from "./job-progress.port"

/**
 * One outside effect a job declares (an act outside the database: a provider call, a mail, a paid model call, a vector write) and how an
 * act whose outcome was lost in a crash is settled: `repeatable` (made again under the same key), `confirm` (a declared read tells), or
 * `person` (a dead letter: only a person decides to act again).
 */
export interface JobEffectDeclaration {
    /** The effect's stable name (`<capability>.<act>`); the effects piece keys its rows `<jobId>:<name>[:<part>]`. */
    readonly name: string
    /** How an unknown outcome is settled. */
    readonly settle: "repeatable" | "confirm" | "person"
}

/**
 * The declaration of one job of a chain: its name and queue, the ladder of its class, the guard of its payload, the once key the
 * producer writes as the outbox dedupe key, the jobs it may enqueue when it finishes (`next`) and its outside effects. The producer and
 * the processor both read it, so the name, the key and the queue are written once. A job enqueues only the jobs its `next` lists.
 */
export interface JobDefinition<P extends object> {
    /** The job name: the kind of the job row and the broker job name. */
    readonly name: string
    /** The queue the job travels on (`<QUEUE>_QUEUE` of its `modules/queues/<queue>`). */
    readonly queue: string
    /** The class of the flow, which picks its one retry ladder. */
    readonly ladder: JobLadderName
    /** The guard of the payload; a payload it refuses is a dead letter at once (class `input`). */
    readonly payload: (value: unknown) => value is P
    /** The identity of one run of the job, the outbox dedupe key `<job name>:<subject id>`: the same key written twice is one job. Ids only. */
    onceKey(payload: P): string
    /** The names of the jobs this job may enqueue in the transaction that finishes it; empty for the end of a chain. */
    readonly next: ReadonlyArray<string>
    /** The outside effects the job makes; empty when it makes none. */
    readonly effects: ReadonlyArray<JobEffectDeclaration>
    /** The progress stream of the job, optional: its state changes and step progress go to the topic; absent = nothing is published. */
    readonly progress?: JobProgressDeclaration<P> | undefined
}

/** Declares a job of a chain; the declaration is frozen so nothing changes it at run time. */
export const defineJob = <P extends object>(definition: JobDefinition<P>): JobDefinition<P> => Object.freeze(definition)
