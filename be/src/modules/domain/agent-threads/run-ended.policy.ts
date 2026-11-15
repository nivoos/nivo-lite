/**
 * THE ENDED RUN (FIX-LIFE part 2): the stored statuses of a run that has ended, whatever ended it (its own end, a person's Skip or
 * Cancel, an erasure of its subject, the sweep abandoning it). An ended run takes no wake (a rung, a round, a deadline, a decision, a
 * re-drive is refused before anything is written) and runs no further step (a drive still in flight when the run was ended outside it
 * stops at its next step): ONE rule, read in the thread wakes' admission and at the start of every step visit.
 */
export const ENDED_RUN_STATUSES: ReadonlySet<string> = new Set(["done", "failed", "cancelled", "dead"])

/** True when a stored run status says the run has ended. */
export const isRunEnded = (status: string): boolean => ENDED_RUN_STATUSES.has(status)
