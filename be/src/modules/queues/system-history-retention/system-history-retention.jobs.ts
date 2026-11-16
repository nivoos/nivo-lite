import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { SYSTEM_HISTORY_RETENTION_QUEUE } from "./system-history-retention.queue"

/** The payload of the end-of-day tick: how old finished history must be before it goes, and the size of one delete batch. */
export interface SystemHistorySweepPayload {
    /** Days a done job is kept. */
    readonly doneDays?: number | undefined
    /** Days a failed job is kept. */
    readonly failedDays?: number | undefined
    /** Rows one delete batch takes. */
    readonly batch?: number | undefined
}

const isOptionalNumber = (value: unknown): boolean => value === undefined || typeof value === "number"

/** True when a job payload is the payload of the end-of-day tick: an object whose windows and batch, when it names them, are numbers. */
export const isSystemHistorySweepPayload = (value: unknown): value is SystemHistorySweepPayload =>
    typeof value === "object" &&
    value !== null &&
    isOptionalNumber("doneDays" in value ? value.doneDays : undefined) &&
    isOptionalNumber("failedDays" in value ? value.failedDays : undefined) &&
    isOptionalNumber("batch" in value ? value.batch : undefined)

/**
 * The end-of-day sweep of finished queue, cron and http history older than its window: deleted in bounded batches, each under the job
 * fence. Nobody waits for it (`background`); it acts nowhere outside the database and enqueues nothing. The tick writes its own once
 * key (`tick:<name>:<minute>`), so the declared key is only the job's name.
 */
export const SWEEP_SYSTEM_HISTORY_JOB: JobDefinition<SystemHistorySweepPayload> = defineJob<SystemHistorySweepPayload>({
    name: SYSTEM_HISTORY_RETENTION_QUEUE,
    queue: SYSTEM_HISTORY_RETENTION_QUEUE,
    ladder: "background",
    payload: isSystemHistorySweepPayload,
    onceKey: () => SYSTEM_HISTORY_RETENTION_QUEUE,
    next: [],
    effects: [],
})
