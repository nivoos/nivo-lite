import type { EntityManager } from "typeorm"

/**
 * Who listens to the facts store: the derived policy layer (PO2) and the vectors of the facts in force (`FactEmbeddingsService`: a
 * value that comes in force gets its vector here, whatever door wrote it). It is told AFTER a write committed that what is in force in
 * a workspace changed: a value applied (or scheduled), retired, taken over at its start, expired, or given another reach. Told after a
 * plain write it must never throw: the write already stands, and the listener records its own failure. Told INSIDE a transaction
 * (`tx`: the finishing transaction of a job that wrote the facts) it writes what it owes (a job, a state row) in that transaction
 * and lets a failure throw, so the finishing writes commit together or not at all and the job's ladder retries.
 */
export interface FactsChangedHook {
    /**
     * What is in force changed in the workspace; `changedIds` are the facts the write produced (the value now in force or scheduled, the
     * retired one, the next version of a new reach, the values that took over at their start), so a listener whose work is per fact
     * (the vectors) touches only those, and one that compares the whole workspace (the policy layer) may ignore them.
     */
    factsChanged(workspaceId: string, changedIds: ReadonlyArray<string>, tx?: EntityManager): Promise<void>
}
