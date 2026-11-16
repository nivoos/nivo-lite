/**
 * THE ENDED RUN (FIX-LIFE part 2): the stored statuses of a run that has ended, whatever ended it (its own end, a person's Skip or
 * End, an erasure of its subject, the sweep abandoning it). An ended run takes no wake (a rung, a round, a deadline, a decision, a
 * re-drive is refused before anything is written) and runs no further step (a drive still in flight when the run was ended outside it
 * stops at its next step): ONE rule, read in the thread wakes' admission and at the start of every step visit.
 *
 * THE PAUSED RUN (RUN-END, same place, same readers): a run a person paused (`parked`, park reason `paused_by_person`) is IN FLIGHT (it
 * keeps its subject) but moves no further: every wake of it is admitted and then HELD `paused:<run>` at its drive (a rung, a round, a
 * wait's event or timeout, a deadline, a person's decision on its stop: each runs once, in the order it came, when a person resumes the
 * run), and a drive still in flight when it was paused stops before its next step (the step running at that instant finishes its act).
 */
export const ENDED_RUN_STATUSES: ReadonlySet<string> = new Set(["done", "failed", "cancelled", "dead"])

/** True when a stored run status says the run has ended. */
export const isRunEnded = (status: string): boolean => ENDED_RUN_STATUSES.has(status)

/** The stored status of a paused run (a person's pause; `park_reason` says it is one). */
export const PAUSED_RUN_STATUS = "parked"

/** True when a stored run status says the run is paused by a person (a thread run is parked by nothing else). */
export const isRunPaused = (status: string): boolean => status === PAUSED_RUN_STATUS

/** The reason a wake of a paused run is held with until the resume: `paused:<run>`. */
export const PAUSED_REASON = "paused:"
