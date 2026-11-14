import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { ACCOUNT_DATA_RETENTION_QUEUE } from "./account-data-retention.queue"

/** The payload of the end-of-day tick: the size of one delete batch (a default when absent). */
export interface AccountDataSweepPayload {
    /** Rows one delete batch takes. */
    readonly batch?: number | undefined
}

/** True when a job payload is the payload of the end-of-day tick: an object whose batch, when it names one, is a number. */
export const isAccountDataSweepPayload = (value: unknown): value is AccountDataSweepPayload =>
    typeof value === "object" && value !== null && (!("batch" in value) || value.batch === undefined || typeof value.batch === "number")

/**
 * The end-of-day sweep of account data: rows past the retention their type declares are deleted in bounded batches, each under the job
 * fence. Nobody waits for it (`background`); it acts nowhere outside the database and enqueues nothing. The tick writes its own once key
 * (`tick:<name>:<minute>`), so the declared key is only the job's name.
 */
export const SWEEP_ACCOUNT_DATA_JOB: JobDefinition<AccountDataSweepPayload> = defineJob<AccountDataSweepPayload>({
    name: ACCOUNT_DATA_RETENTION_QUEUE,
    queue: ACCOUNT_DATA_RETENTION_QUEUE,
    ladder: "background",
    payload: isAccountDataSweepPayload,
    onceKey: () => ACCOUNT_DATA_RETENTION_QUEUE,
    next: [],
    effects: [],
})
