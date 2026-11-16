import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { REALTIME_RETENTION_QUEUE } from "./realtime-retention.queue"

/** The payload of the minute tick: a literal marker, nothing else. */
export interface RealtimeSweepPayload {
    /** Marks the tick. */
    readonly tick?: true | undefined
}

/** True when a job payload is the payload of the minute tick: an object that carries no member the tick does not write. */
export const isRealtimeSweepPayload = (value: unknown): value is RealtimeSweepPayload =>
    typeof value === "object" && value !== null && (!("tick" in value) || value.tick === undefined || value.tick === true)

/**
 * The minute sweep of the realtime replay frames older than the replay window: deleted in bounded batches, each under the job fence; a
 * repeated pass changes nothing more. Nobody waits for it (`background`); it acts nowhere outside the database and enqueues nothing. The
 * tick writes its own once key (`tick:<name>:<minute>`), so the declared key is only the job's name.
 */
export const SWEEP_REALTIME_EVENTS_JOB: JobDefinition<RealtimeSweepPayload> = defineJob<RealtimeSweepPayload>({
    name: REALTIME_RETENTION_QUEUE,
    queue: REALTIME_RETENTION_QUEUE,
    ladder: "background",
    payload: isRealtimeSweepPayload,
    onceKey: () => REALTIME_RETENTION_QUEUE,
    next: [],
    effects: [],
})
