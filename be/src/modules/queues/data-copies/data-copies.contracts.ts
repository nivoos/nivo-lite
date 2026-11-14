import { DomainError } from "@modules/platform/errors"
import { QueueError, QueueErrorCode } from "@modules/platform/queue"

/** The queue name: the contract between the producer, the ticks `data-backup-tick` and `data-verify-tick` of platform/jobs and the processors of the data copy jobs (the durable queue name). */
export const DATA_COPIES_QUEUE = "data_copies"

/** The jobs of the data-copies queue; the value is the job name inside the queue (the tick's own job names, as `JOB_TICKS` writes them) and the prefix of a dedupe key. */
export enum DataCopiesJob {
    /** The hourly tick: queues one backup job for each data set that has a slot to run in. */
    BackupDue = "data.backup-due",
    /** One backup of one data set in one slot. */
    Backup = "data.backup",
    /** The daily tick: verifies the newest copy of every backup data set. */
    Verify = "data.verify",
}

/** The payload of a tick: it names nothing, the job reads the declared data sets. */
export interface DataCopiesTickPayload {
    /** Marks the tick. */
    readonly tick: true
}

/** True when a job payload is the payload of a tick. */
export const isDataCopiesTickPayload = (value: unknown): value is DataCopiesTickPayload =>
    typeof value === "object" && value !== null && "tick" in value && value.tick === true

/** The payload of one backup: which data set and which slot of its schedule (ids and numbers only). */
export interface DataBackupPayload {
    /** The data set's id (`DataSetDeclaration.id`). */
    readonly setId: string
    /** The slot: the number of whole `everyMinutes` periods since the epoch, so two ticks in one period name one slot. */
    readonly slot: number
}

/** True when a job payload is the payload of one backup. */
export const isDataBackupPayload = (value: unknown): value is DataBackupPayload =>
    typeof value === "object" &&
    value !== null &&
    "setId" in value &&
    typeof value.setId === "string" &&
    value.setId !== "" &&
    "slot" in value &&
    typeof value.slot === "number" &&
    Number.isInteger(value.slot)

/** The identity of one backup job: the data set and its slot (the same key written twice is one job, so two ticks never run one slot twice). */
export const dataBackupDedupeKey = (payload: DataBackupPayload): string =>
    `${DataCopiesJob.Backup}:${payload.setId}:${String(payload.slot)}`

/** The class a data copy failure ends with: `transient` (the job runner retries it on the ladder), `config` (a setting or a limit only a person can change), `input` (a finding a person must read) or `code` (a defect). */
export type DataCopyFailureClass = "transient" | "config" | "input" | "code"

/** The longest reason a failure carries. */
const REASON_MAX = 300

/**
 * A flow failure of a data copy job with its class named, so the ONE judge (`classifyFailure` in the job runner) retries a transient one on
 * the ladder and dead-letters any other with one item for a person. The reason names codes and ids only, never a value.
 */
export const dataCopyFailure = (
    failureClass: DataCopyFailureClass,
    reason: string,
    cause?: unknown,
): DomainError<string> =>
    new QueueError({
        code: QueueErrorCode.FlowFailure,
        params: { failureClass, reason: reason.slice(0, REASON_MAX) },
        ...(cause === undefined ? {} : { cause }),
    })
