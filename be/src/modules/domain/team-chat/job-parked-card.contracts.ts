/**
 * The `job.parked` card: its payload contract is the agent-sdk core kind (`jobParkedKind`, nivo-frame `team-chat` rule 10); this file
 * re-exports it for be and keeps the be-only shapes (the report, how a post went).
 */
import type { JobParkedFailureClass, JobParkedPayload } from "@nivo-lite/agent-sdk/team-chat"

export { JOB_PARKED_FAILURE_CLASSES } from "@nivo-lite/agent-sdk/team-chat"
export type { JobParkedFailureClass, JobParkedPayload } from "@nivo-lite/agent-sdk/team-chat"

/** A `job.parked` card as a screen reads it. */
export type JobParkedCardView = Omit<JobParkedPayload, "version">

/** The card a line carries, or null when it carries none (or another kind). */
export type OptionalJobParkedCardView = JobParkedCardView | null

/** The stored payload of a line, or null when it carries none (or another kind). */
export type OptionalJobParkedPayload = JobParkedPayload | null

/** One parked job to report: which job, why, and the park episode it belongs to (one card per job and episode, never per delivery). */
export interface JobParkedReport {
    /** The parked job (its id). */
    readonly jobId: string
    /** The job's name. */
    readonly job: string
    /** Why it will not run on its own. */
    readonly failureClass: JobParkedFailureClass
    /** The failure code. */
    readonly reason: string
    /** How many times a person resumed the job before this park. */
    readonly episode: number
}
