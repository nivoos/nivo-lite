/**
 * The class of a flow, by who waits on it: `background` (nobody waits; a batch, a sync, an index) or `waited` (a person waits on the
 * result: a reply, a draft, a connection being set up). The class picks the ONE retry ladder of the flow; no job declares pauses of its own.
 */
export type JobLadderName = "background" | "waited"

/** How a transient failure is tried again: how many starts a delivery gets in all, and the pause before each start after the first. */
export interface JobLadder {
    /** The starts a delivery gets, the first included; a start past this count is a dead letter without running. */
    readonly starts: number
    /** The pause before start n+2 after start n+1 failed, in seconds (index 0 = the pause after the first start). */
    readonly pausesSeconds: ReadonlyArray<number>
}

/** The two ladders, declared once: background = the queue's short tries (5, 10, 20 s), waited = 1, 2, 4, 8 minutes. */
export const JOB_LADDERS: Readonly<Record<JobLadderName, JobLadder>> = {
    background: { starts: 4, pausesSeconds: [5, 10, 20] },
    waited: { starts: 5, pausesSeconds: [60, 120, 240, 480] },
}

/** What the runner does with a failure of a delivery on its `start`-th start. */
export type LadderVerdict =
    | { readonly kind: "retry"; readonly afterSeconds: number }
    | { readonly kind: "dead-letter"; readonly why: "class" | "exhausted" }

/**
 * The verdict of the ladder for a failure: a transient failure with starts left is tried again after the ladder's pause; any other
 * class, or a transient failure on (or past) the last start, is a dead letter. The start count is the durable one (`job_start` counts a
 * start before the work runs), so a crash on every start also ends here.
 */
export const ladderVerdictOf = (ladder: JobLadder, start: number, transient: boolean): LadderVerdict => {
    if (!transient) return { kind: "dead-letter", why: "class" }
    if (start >= ladder.starts) return { kind: "dead-letter", why: "exhausted" }
    const pause = ladder.pausesSeconds[Math.max(0, start - 1)] ?? ladder.pausesSeconds.at(-1) ?? 1
    return { kind: "retry", afterSeconds: pause }
}

/** True when a delivery already started more often than its ladder allows: every earlier start died without settling (a crash). */
export const isPastLadder = (ladder: JobLadder, start: number): boolean => start > ladder.starts
