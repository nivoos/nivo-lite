/** Log events of the brain capability. */
export enum BrainLogEvent {
    /** Taking back what a deleted document contributed failed; the document is gone all the same. */
    WithdrawFailed = "brain.source.withdraw_failed",
    /** Filing one fact read from a document failed; the others are still filed. */
    FilingFailed = "brain.extraction.filing_failed",
    /** Answering the gaps a fact or document covers failed; the fact or document is stored all the same. */
    GapsFailed = "brain.gaps.resolve_failed",
    /** Answering the gaps a fact or document covers failed; the fact or document is stored all the same. */
    /** A model answer could not be read at all: no object or list in it parses (one event per answer; length and slices tried, no text). */
    AnswerUnreadable = "brain.model.answer_unreadable",
    /** One slice of a model answer did not parse but another did: the answer was read (the slice kinds only). */
    AnswerSliceRetried = "brain.model.answer_slice_retried",
    /** A command job ended; the outcome says how. */
    CommandRan = "brain.command.ran",
    /** A command was refused by the services; the row carries the stored code. */
    CommandRefused = "brain.command.refused",
    /** One fact of a bulk apply could not be applied (it was decided meanwhile, or the write failed); the others go on. */
    BulkFactSkipped = "brain.bulk.fact_skipped",
    /** Linking the facts of one document into the truth graph failed; the facts stand without edges. */
    RelationsFailed = "brain.relations.link_failed",
    /** Embedding the changed facts failed; they stay searchable by words and the vector reconcile embeds them. */
    EmbeddingsFailed = "brain.embeddings.refresh_failed",
    /** One pass of the timed brain upkeep tick ended: the workspaces it queued, the readings it resumed. */
    UpkeepDone = "brain.upkeep.done",
}
