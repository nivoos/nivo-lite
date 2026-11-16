import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import {
    CONNECTION_HEALTH_JOB,
    CONNECTION_HEALTH_QUEUE,
    isConnectionHealthPayload,
    type ConnectionHealthPayload,
} from "./connection-health.queue"

/**
 * The health tick: every connection that is set up is judged and a changed verdict is recorded on it. It reads and writes the database
 * only (no outside call) and nobody waits (`background`); the next tick is the sweep that brings back what a crash left. Dead-lettered
 * work parks with one item for a person like any job.
 */
export const CHECK_CONNECTION_HEALTH_JOB: JobDefinition<ConnectionHealthPayload> = defineJob<ConnectionHealthPayload>({
    name: CONNECTION_HEALTH_JOB,
    queue: CONNECTION_HEALTH_QUEUE,
    ladder: "background",
    payload: isConnectionHealthPayload,
    onceKey: () => CONNECTION_HEALTH_JOB,
    next: [],
    effects: [],
})
