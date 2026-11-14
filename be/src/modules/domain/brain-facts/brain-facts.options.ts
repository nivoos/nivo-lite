/**
 * The full truth graph (the api, the mcp): its rows, their reads and writes, and the meaning half (the facts' search through the vector
 * index and the rows the vector sync reads), so the app composes the vector index.
 */
export interface BrainFactsFullOptions {
    /** Absent or false: the full capability. */
    readonly rowsOnly?: false
}

/**
 * The rows-only mode of an app that writes and reads facts by words but never searches by meaning or embeds (the cli): no
 * `BrainFactEmbeddingsService` and no `FactVectorRowsService`, so the app composes no vector index and needs no `QDRANT_URL`. A fact it
 * writes gets its point from the api's vector reconcile (tick `vector-reconcile`). A capability that asks for the meaning half cannot be
 * composed beside this mode: its injection is unresolved at boot (and in the app's composition spec).
 */
export interface BrainFactsRowsOnlyOptions {
    /** Registers the rows-only mode. */
    readonly rowsOnly: true
}

/** What the brain-facts capability needs from the composition root: the full capability or the rows-only mode. */
export type BrainFactsOptions = BrainFactsFullOptions | BrainFactsRowsOnlyOptions
