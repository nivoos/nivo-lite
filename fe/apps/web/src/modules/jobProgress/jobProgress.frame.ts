/** The states a job's progress frame tells (be/src/modules/platform/jobs: the frame is a view of the job row). */
type JobProgressFrameState = "running" | "retry" | "done" | "dead_letter"

/** One frame of the job-progress stream: a change of a job's state or a report of its step. Keys and numbers only, never a sentence. */
export interface JobProgressFrame {
    /** Unique within the stream. */
    readonly id: string
    /** The chain the job belongs to (`<kind>:<id>`): one stream carries many chains, so a frame says whose it is. */
    readonly root: string
    readonly jobId: string
    /** The kind of the job (its name). */
    readonly job: string
    readonly state: JobProgressFrameState
    /** The attempt that runs or is retried, when the row says. */
    readonly attempt?: number | undefined
    /** When the retry runs, as an ISO time; only in state `retry` (also in the snapshot a late subscriber gets) and only when known. */
    readonly retryAt?: string | undefined
    /** The class of the failure; only in state `dead_letter`. */
    readonly failureClass?: string | undefined
    /** Units of the current step that are done, with `total`. */
    readonly done?: number | undefined
    readonly total?: number | undefined
    /** The label key of the step, worded by the catalogue; never shown raw. */
    readonly labelKey?: string | undefined
    /** ISO 8601 time of the change; the newest frame of a job wins. */
    readonly at: string
}

const STATES: ReadonlySet<string> = new Set(["running", "retry", "done", "dead_letter"])

/** True when a value is absent or has the type; the optional fields of a frame are absent, never null. */
const isOptional = (value: unknown, type: "string" | "number"): boolean => value === undefined || typeof value === type

/** True when a parsed JSON value is a progress frame. */
export const isJobProgressFrame = (value: unknown): value is JobProgressFrame =>
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "root" in value &&
    typeof value.root === "string" &&
    "jobId" in value &&
    typeof value.jobId === "string" &&
    "job" in value &&
    typeof value.job === "string" &&
    "state" in value &&
    typeof value.state === "string" &&
    STATES.has(value.state) &&
    "at" in value &&
    typeof value.at === "string" &&
    isOptional("attempt" in value ? value.attempt : undefined, "number") &&
    isOptional("retryAt" in value ? value.retryAt : undefined, "string") &&
    isOptional("failureClass" in value ? value.failureClass : undefined, "string") &&
    isOptional("done" in value ? value.done : undefined, "number") &&
    isOptional("total" in value ? value.total : undefined, "number") &&
    isOptional("labelKey" in value ? value.labelKey : undefined, "string")
