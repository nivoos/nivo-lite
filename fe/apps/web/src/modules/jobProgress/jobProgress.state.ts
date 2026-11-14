import type { JobProgressFrame } from "./jobProgress.frame"

/** Where a chain of jobs stands: no frame yet (`none`), or the state of the job that matters most. */
type JobProgressKind = "none" | "running" | "retry" | "done" | "dead_letter"

/** The typed state of one chain of jobs, as the hook gives it. Keys and numbers only: the words come from `jobProgress.words`. */
export interface JobProgressView {
    readonly state: JobProgressKind
    /** The kind of the job the state is about; null when none. */
    readonly job: string | null
    readonly attempt: number | null
    readonly done: number | null
    readonly total: number | null
    /** The label key of the step the job reports; null when it reports none. */
    readonly labelKey: string | null
    /** When the retry runs (ISO); null unless the state is `retry` and the time is known. */
    readonly retryAt: string | null
    /** The class of the failure; null unless the state is `dead_letter`. */
    readonly failureClass: string | null
}

/** The newest frame of each job of one chain, by job id. */
export type JobFrames = Readonly<Record<string, JobProgressFrame>>

/** The newest frame of each job of each chain a stream carries, by chain root. */
export type JobFramesByRoot = Readonly<Record<string, JobFrames>>

/** The most chains one request may name (the door refuses a longer list): more than this are followed through the whole-workspace view. */
export const JOB_PROGRESS_ROOTS_MAX = 50

/** What one stream asks of the door: the chains by name (1 to 50), or every chain of the workspace (the one view that holds any number). */
export type JobProgressSelector =
    | { readonly kind: "roots"; readonly roots: ReadonlyArray<string> }
    | { readonly kind: "all" }

/** A chain nothing was heard of yet. */
export const NO_JOB_PROGRESS: JobProgressView = {
    state: "none",
    job: null,
    attempt: null,
    done: null,
    total: null,
    labelKey: null,
    retryAt: null,
    failureClass: null,
}

/** How much a state matters when a chain holds several jobs: a job that needs a person first, then one that waits to retry, then one that runs. */
const WEIGHT: Readonly<Record<JobProgressFrame["state"], number>> = { dead_letter: 4, retry: 3, running: 2, done: 1 }

/** The frames with this one kept when it is newer than the one held for its job (a repeat or an older frame changes nothing). */
export const withFrame = (frames: JobFrames, frame: JobProgressFrame): JobFrames => {
    const held = frames[frame.jobId]
    return held !== undefined && Date.parse(held.at) > Date.parse(frame.at)
        ? frames
        : { ...frames, [frame.jobId]: frame }
}

/** The frames of every chain with this frame kept in its own chain (the newest frame of its job wins, whatever stream it came on). */
export const withRootFrame = (held: JobFramesByRoot, frame: JobProgressFrame): JobFramesByRoot => ({
    ...held,
    [frame.root]: withFrame(held[frame.root] ?? {}, frame),
})

/** The chains named without repeats, in a stable order. */
const uniqueRoots = (roots: ReadonlyArray<string>): ReadonlyArray<string> =>
    [...new Set(roots)].sort((left, right) => left.localeCompare(right))

/**
 * What ONE stream asks of the door for the chains in view: those chains by name, or, past the door's limit, every chain of the
 * workspace (the stream then also carries chains nobody looks at: they are kept apart by their root). Null when no chain is in view.
 */
export const selectorOf = (roots: ReadonlyArray<string>): JobProgressSelector | null => {
    const named = uniqueRoots(roots)
    if (named.length === 0) return null
    return named.length > JOB_PROGRESS_ROOTS_MAX ? { kind: "all" } : { kind: "roots", roots: named }
}

/** Whether the first frame is the one that matters more: a heavier state, else the newer. */
const outranks = (frame: JobProgressFrame, held: JobProgressFrame): boolean =>
    WEIGHT[frame.state] !== WEIGHT[held.state]
        ? WEIGHT[frame.state] > WEIGHT[held.state]
        : Date.parse(frame.at) > Date.parse(held.at)

/** The state of the chain: the job that matters most (needs a person, waits to retry, runs, else the newest done). */
export const viewOfFrames = (frames: JobFrames | undefined): JobProgressView => {
    const top = Object.values(frames ?? {}).reduce<JobProgressFrame | undefined>(
        (best, frame) => (best === undefined || outranks(frame, best) ? frame : best),
        undefined,
    )
    if (top === undefined) return NO_JOB_PROGRESS
    return {
        state: top.state,
        job: top.job,
        attempt: top.attempt ?? null,
        done: top.done ?? null,
        total: top.total ?? null,
        labelKey: top.labelKey ?? null,
        retryAt: top.state === "retry" ? (top.retryAt ?? null) : null,
        failureClass: top.state === "dead_letter" ? (top.failureClass ?? null) : null,
    }
}
