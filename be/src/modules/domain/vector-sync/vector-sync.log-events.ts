/** Log events of the vector-sync capability. */
export enum VectorSyncLogEvent {
    /** A sync job brought rows in step with their points (the counts say how). */
    Synced = "vector.sync.done",
    /** One run of the reconcile ended (the counts per kind, whether a follow-up was queued). */
    Reconciled = "vector.reconcile.done",
}
