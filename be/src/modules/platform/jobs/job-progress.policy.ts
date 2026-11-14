import type { RealtimeTopic } from "@modules/platform/realtime"
import type { JobProgressTopic } from "./job-progress.port"
import type { JobState } from "./persistence/entities"

/** The most chains one subscription may name at once. */
export const JOB_PROGRESS_MAX_ROOTS = 50

/** How far back the current state of a whole workspace reaches: the rows changed within this many hours. */
export const JOB_PROGRESS_RECENT_HOURS = 24

/** The states a job's progress frame tells. */
export type JobProgressState = "running" | "retry" | "done" | "dead_letter"

/**
 * One frame of a job's progress: a state change of the job row or a step report. Keys and numbers only: no text a person reads. `id`
 * is unique within the topic (the resume point); `at` orders frames for a client (the newest wins).
 */
export interface JobProgressFrame {
    /** The domain event id of the frame: unique within its topic. */
    readonly id: string
    /** The frame kind, always `job`. */
    readonly kind: "job"
    /** The chain this frame belongs to, `<kind>:<id>`: how a subscriber of many chains tells which one a frame is about. */
    readonly root: string
    /** The job name (the kind of the job row). */
    readonly job: string
    /** The id of the job row. */
    readonly jobId: string
    /** The state the job row is in. */
    readonly state: JobProgressState
    /** The attempt that is running or retried; absent when the row does not say. */
    readonly attempt?: number | undefined
    /** When the retry runs, as an ISO time; present only in state `retry` when known. */
    readonly retryAt?: string | undefined
    /** The class of the failure; present only in state `dead_letter`. */
    readonly failureClass?: string | undefined
    /** Units done of the current step; present with `total` on a step report. */
    readonly done?: number | undefined
    /** Units the current step has in all. */
    readonly total?: number | undefined
    /** The label KEY of the step (`<job>.<step>`), worded by the fe's catalogue `jobProgress.<job>.<labelKey>`. */
    readonly labelKey?: string | undefined
    /** When the change happened, as an ISO time. */
    readonly at: string
}

const STATES: ReadonlySet<string> = new Set<JobProgressState>(["running", "retry", "done", "dead_letter"])

const isOptional = (value: unknown, type: "string" | "number"): boolean => value === undefined || typeof value === type

/** True when a value is a job progress frame (the topic delivers nothing else). */
export const isJobProgressFrame = (value: unknown): value is JobProgressFrame =>
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "kind" in value &&
    value.kind === "job" &&
    "root" in value &&
    typeof value.root === "string" &&
    "job" in value &&
    typeof value.job === "string" &&
    "jobId" in value &&
    typeof value.jobId === "string" &&
    "state" in value &&
    typeof value.state === "string" &&
    STATES.has(value.state) &&
    "at" in value &&
    typeof value.at === "string" &&
    (!("attempt" in value) || isOptional(value.attempt, "number")) &&
    (!("retryAt" in value) || isOptional(value.retryAt, "string")) &&
    (!("failureClass" in value) || isOptional(value.failureClass, "string")) &&
    (!("done" in value) || isOptional(value.done, "number")) &&
    (!("total" in value) || isOptional(value.total, "number")) &&
    (!("labelKey" in value) || isOptional(value.labelKey, "string"))

/** The shape of a chain root: `<kind>:<id>`, no space, as the producer's topic declares it; the door refuses any other root. */
export const JOB_PROGRESS_ROOT_PATTERN: RegExp = /^[A-Za-z0-9_.-]{1,64}:[A-Za-z0-9_.:-]{1,128}$/u

/** The pattern of a list of chain roots as the door takes it: one root or up to the most chains, comma separated. */
export const JOB_PROGRESS_ROOTS_PATTERN: RegExp = (() => {
    const one = JOB_PROGRESS_ROOT_PATTERN.source.slice(1, -1)
    return new RegExp(`^${one}(?:,${one}){0,${JOB_PROGRESS_MAX_ROOTS - 1}}$`, "u")
})()

/** The patterns a door validates its selectors by. */
export interface JobProgressSelectorPatterns {
    /** The pattern of `root`: one chain. */
    readonly root: RegExp
    /** The pattern of `roots`: a bounded comma separated list of chains. */
    readonly roots: RegExp
}

/** The patterns a door validates its selectors by: `root` names one chain, `roots` a bounded comma separated list of them. */
export const JOB_PROGRESS_SELECTOR_PATTERNS: JobProgressSelectorPatterns = {
    root: JOB_PROGRESS_ROOT_PATTERN,
    roots: JOB_PROGRESS_ROOTS_PATTERN,
}

const CHAIN_PREFIX = "job-progress:"

/**
 * The name a job row records for its chain: the workspace first (the principal whose members may read it), then the chain's root. It is
 * the KEY the current state is read by, never a hub topic. A workspace id holds no colon.
 */
export const jobProgressTopicName = (topic: JobProgressTopic): string => `${CHAIN_PREFIX}${topic.workspaceId.toLowerCase()}:${topic.root}`

/** The workspace and root a recorded chain name was built from, or undefined for a name that is not one. */
export const jobProgressTopicOfName = (name: string): JobProgressTopic | undefined => {
    if (!name.startsWith(CHAIN_PREFIX)) return undefined
    const rest = name.slice(CHAIN_PREFIX.length)
    const cut = rest.indexOf(":")
    if (cut <= 0) return undefined
    const root = rest.slice(cut + 1)
    return JOB_PROGRESS_ROOT_PATTERN.test(root) ? { workspaceId: rest.slice(0, cut), root } : undefined
}

/** The prefix every chain name of a workspace starts with, as a LIKE pattern (its own wildcards escaped). */
export const jobProgressChainsLike = (workspaceId: string): string =>
    CHAIN_PREFIX + workspaceId.toLowerCase().replaceAll(/[%\\_]/gu, String.raw`\$&`) + ":%"

/** The ONE hub topic of a workspace: every progress frame of every chain of it, each carrying its root; the door filters by root. */
export const jobProgressTopic = (workspaceId: string): RealtimeTopic<JobProgressFrame> => ({
    name: `${CHAIN_PREFIX}${workspaceId.toLowerCase()}`,
    accepts: isJobProgressFrame,
})

/** What a subscription asks for: the workspace, and the chains of it as the door took them (neither selector = every chain of the workspace). */
export interface JobProgressScope {
    /** The workspace whose members may subscribe. */
    readonly workspaceId: string
    /** One chain root. */
    readonly root?: string | undefined
    /** Several chain roots, comma separated. */
    readonly roots?: string | undefined
}

/** The chain roots a scope names, without repeats; an empty list means the whole workspace. */
export const jobProgressRootsOf = (scope: JobProgressScope): ReadonlyArray<string> => {
    const named = [...(scope.root === undefined ? [] : [scope.root]), ...(scope.roots === undefined ? [] : scope.roots.split(","))]
    return [...new Set(named)]
}

/** The id of a frame: unique within a topic for one job, one state, one attempt, one step count at one instant. */
export const jobProgressFrameId = (frame: Pick<JobProgressFrame, "jobId" | "state" | "attempt" | "done" | "at">): string =>
    [frame.jobId, frame.state, frame.attempt ?? "", frame.done ?? "", Date.parse(frame.at)].join(":")

/** The columns of a job row the current state is read from. */
export interface JobProgressRow {
    /** The id of the job row. */
    readonly id: string
    /** The kind of the job row. */
    readonly kind: string
    /** The recorded chain name of the row (`job-progress:<workspace>:<root>`). */
    readonly progressTopic: string | null
    /** The status of the row. */
    readonly status: JobState
    /** The class of the failure of a parked row. */
    readonly failureClass: string | null
    /** Units done as the last report said. */
    readonly progressDone: number | null
    /** Units in all as the last report said. */
    readonly progressTotal: number | null
    /** The label key of the last report. */
    readonly progressLabel: string | null
    /** When the last report was made. */
    readonly progressAt: Date | null
    /** When a waiting retry runs again, as the runner scheduled it; null when none was stored. */
    readonly progressRetryAt: Date | null
    /** When the row last changed. */
    readonly updatedAt: Date
}

const stateOf = (status: JobState): JobProgressState => {
    if (status === "done") return "done"
    if (status === "failed") return "retry"
    if (status === "failed_awaiting_fix") return "dead_letter"
    return "running"
}

/** The current state of a job row as one frame, or undefined for a row with no chain name: what a late subscriber reads before the live frames. The row holds no attempt, so the frame names none; a retry carries the time the runner scheduled. */
export const frameOfRow = (row: JobProgressRow): JobProgressFrame | undefined => {
    const chain = row.progressTopic === null ? undefined : jobProgressTopicOfName(row.progressTopic)
    if (chain === undefined) return undefined
    const state = stateOf(row.status)
    const reported = state === "running" && row.progressDone !== null && row.progressTotal !== null
    const at = (reported && row.progressAt !== null ? row.progressAt : row.updatedAt).toISOString()
    const base = { kind: "job" as const, root: chain.root, job: row.kind, jobId: row.id, state, at }
    return {
        id: jobProgressFrameId({ jobId: row.id, state, attempt: undefined, done: row.progressDone ?? undefined, at }),
        ...base,
        ...(state === "dead_letter" && row.failureClass !== null ? { failureClass: row.failureClass } : {}),
        ...(state === "retry" && row.progressRetryAt !== null ? { retryAt: row.progressRetryAt.toISOString() } : {}),
        ...(reported
            ? { done: row.progressDone ?? 0, total: row.progressTotal ?? 0, labelKey: row.progressLabel ?? undefined }
            : {}),
    }
}
