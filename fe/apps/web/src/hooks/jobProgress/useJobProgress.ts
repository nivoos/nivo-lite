"use client"

import { useSubscribeJobProgressSwr } from "@/hooks/swr"
import { NO_JOB_PROGRESS, viewOfFrames, type JobProgressView } from "@/modules/jobProgress"

/** The chains the hook follows and what they say. */
interface JobProgress {
    /** The typed state of a chain; `state: "none"` while nothing was heard of it (or it is not followed). */
    readonly of: (root: string) => JobProgressView
}

/**
 * The one hook over the generic job-progress door: the chains in view (roots `<kind>:<id>`, e.g. `knowledge-source:<id>`) are followed on
 * ONE stream (the current state of each job first, with a retry time, then live frames) and each root gives the typed state `{ state, job, attempt, done, total,
 * labelKey, retryAt, failureClass }`. `storedRead` names the SWR read that holds the chains' state in the database: it is read again each
 * time a stream (re)opens. Nothing is followed while nobody is signed in, no workspace is open or no root is given.
 * Label keys are never shown raw: the words come from `jobStateOf`.
 */
export const useJobProgress = (roots: ReadonlyArray<string>, storedRead: string): JobProgress => {
    const held = useSubscribeJobProgressSwr(roots, storedRead).data
    return { of: (root) => (held === undefined ? NO_JOB_PROGRESS : viewOfFrames(held[root])) }
}
