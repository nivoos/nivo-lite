/**
 * How often a run is read again: fast only while a step that is not a wait executes, slow while the run is parked (on a wait for a
 * customer's message, a payment or a change of an order, on a person, a timer, or paused), slower while nothing changes.
 */
export const RUN_FAST_MS = 3_000
export const RUN_PARKED_MS = 30_000
export const POLL_MAX_MS = 60_000

/** How often the runs board is read while a run executes a step or waits for its place, and while every run in flight is parked. */
export const BOARD_BUSY_MS = 5_000
export const BOARD_PARKED_MS = 30_000

/** A step that began longer ago than this is not "executing now": a run whose last step is that old waits (for a customer, a payment, a timer). */
const EXECUTING_WINDOW_MS = 2 * 60_000

/** After this many reads that changed nothing the interval doubles, up to `POLL_MAX_MS`. */
const UNCHANGED_BEFORE_BACKOFF = 3

/** What the poll needs of a run read. */
export interface PolledRun {
    readonly row: {
        readonly status: string
        /** The back end's word that the run is parked (a wait, a person, a timer, a pause): no step of it executes now. */
        readonly parked?: boolean | null | undefined
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
export const isInFlight = (status: string): boolean =>
    status === "running" || status === "waiting" || status === "paused"

/** A cheap text that changes exactly when something the page draws changes (a growing duration is not a change). */
export const runSignatureOf = (run: PolledRun | null | undefined): string => {
    if (run === null || run === undefined) return ""
    const steps = run.steps
        .map((step) => `${step.ordinal}:${step.status}:${step.attempt}:${step.errorCode ?? ""}`)
        .join(",")
    const flags = `${run.canCancel ? "c" : ""}${run.canPause ? "p" : ""}${run.canResume ? "r" : ""}${run.row.parked === true ? "w" : ""}`
    return [
        run.row.status,
        run.row.stepNumber,
        run.row.stepTotal,
        run.row.queuePosition ?? "",
        run.decision?.decisionId ?? "",
        flags,
        steps,
    ].join("|")
}

/**
 * Whether the run executes a step now: it runs, the back end does not call it parked (a wait step is `running` for as long as it waits,
 * hours or days, and is never "executing"), and a step of it began within the last two minutes and has not finished. A run whose
 * steps are all older (a stuck or long step) is read slowly too.
 */
export const isExecuting = (run: PolledRun, now: number): boolean =>
    run.row.status === "running" &&
    run.row.parked !== true &&
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
    const base = isExecuting(run, now) ? RUN_FAST_MS : RUN_PARKED_MS
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

/** What the board poll needs of a runs read. */
export interface PolledBoard {
    readonly runs: ReadonlyArray<{ readonly status: string; readonly parked?: boolean | null | undefined }>
}

/** Whether the board has a run that executes a step (running and not parked) or waits for its place (queued, scheduled). */
export const isBoardBusy = (board: PolledBoard | null | undefined): boolean =>
    (board?.runs ?? []).some(
        (run) =>
            (run.status === "running" && run.parked !== true) || run.status === "queued" || run.status === "scheduled",
    )

/** The wait before the next read of the runs board: 5 s while a run executes or waits for its place, else 30 s; doubled (to 60 s) after reads that changed nothing. */
export const boardPollMsOf = (board: PolledBoard | null | undefined, unchanged: number): number => {
    const base = isBoardBusy(board) ? BOARD_BUSY_MS : BOARD_PARKED_MS
    const doublings = Math.max(0, unchanged - UNCHANGED_BEFORE_BACKOFF + 1)
    return Math.min(POLL_MAX_MS, base * 2 ** Math.min(doublings, 6))
}
