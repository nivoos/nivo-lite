/** How often a run is read again: fast only while a step is executing, slow while it is parked on a wait, slower while nothing changes. */
export const RUN_FAST_MS = 3_000
export const RUN_PARKED_MS = 30_000
export const POLL_MAX_MS = 60_000

/** A step that began longer ago than this is not "executing now": a run whose last step is that old waits (for a customer, a payment, a timer). */
const EXECUTING_WINDOW_MS = 2 * 60_000

/** After this many reads that changed nothing the interval doubles, up to `POLL_MAX_MS`. */
const UNCHANGED_BEFORE_BACKOFF = 3

/** What the poll needs of a run read. */
export interface PolledRun {
    readonly row: {
        readonly status: string
        readonly stepNumber: number
        readonly stepTotal: number
        readonly queuePosition?: number | null | undefined
    }
    readonly steps: ReadonlyArray<{
        readonly ordinal: number
        readonly status: string
        readonly attempt: number
        readonly errorCode?: string | null | undefined
        readonly startedAt?: string | null | undefined
    }>
    readonly decision?: { readonly decisionId: string } | null | undefined
    readonly canCancel: boolean
    readonly canPause: boolean
    readonly canResume: boolean
}

/** Whether a run is still in flight (running, waiting for a place, paused): the only runs that are read again. */
export const isInFlight = (status: string): boolean => status === "running" || status === "waiting" || status === "paused"

/** A cheap text that changes exactly when something the page draws changes (a growing duration is not a change). */
export const runSignatureOf = (run: PolledRun | null | undefined): string => {
    if (run === null || run === undefined) return ""
    const steps = run.steps.map((step) => `${step.ordinal}:${step.status}:${step.attempt}:${step.errorCode ?? ""}`).join(",")
    const flags = `${run.canCancel ? "c" : ""}${run.canPause ? "p" : ""}${run.canResume ? "r" : ""}`
    return [run.row.status, run.row.stepNumber, run.row.stepTotal, run.row.queuePosition ?? "", run.decision?.decisionId ?? "", flags, steps].join("|")
}

/** Whether a step of the run began within the last two minutes and has not finished: the run is executing, not parked. */
export const isExecuting = (run: PolledRun, now: number): boolean =>
    run.steps.some(
        (step) =>
            step.status === "running" &&
            step.startedAt !== undefined &&
            step.startedAt !== null &&
            now - new Date(step.startedAt).getTime() < EXECUTING_WINDOW_MS,
    )

/** The wait before the next read of a run: 0 once it ended; 3 s while a step executes; 30 s while parked; doubled (to 60 s) after reads that changed nothing. */
export const runPollMsOf = (run: PolledRun | null | undefined, unchanged: number, now: number): number => {
    if (run === null || run === undefined || !isInFlight(run.row.status)) return 0
    const base = run.row.status === "running" && isExecuting(run, now) ? RUN_FAST_MS : RUN_PARKED_MS
    const doublings = Math.max(0, unchanged - UNCHANGED_BEFORE_BACKOFF + 1)
    return Math.min(POLL_MAX_MS, base * 2 ** Math.min(doublings, 6))
}

/** The poll of one read: remembers the signature of the last answer and how many reads in a row left it the same. */
export interface PollMemory {
    signature: string
    unchanged: number
}

/** Updates the memory with a new answer's signature and answers how many reads in a row changed nothing. */
export const unchangedAfter = (memory: PollMemory, signature: string): number => {
    if (memory.signature === signature) memory.unchanged += 1
    else {
        memory.signature = signature
        memory.unchanged = 0
    }
    return memory.unchanged
}
