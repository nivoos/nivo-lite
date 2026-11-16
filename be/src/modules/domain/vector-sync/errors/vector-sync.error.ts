import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the vector-sync capability. */
export enum VectorSyncErrorCode {
    /** The embeddings provider answered nothing usable for a batch of rows: the job is retried on its ladder. */
    EmbeddingUnavailable = "VECTOR_SYNC_EMBEDDING_UNAVAILABLE",
    /** The vector index does not answer: the reconcile run is retried on its ladder. */
    IndexUnavailable = "VECTOR_SYNC_INDEX_UNAVAILABLE",
    /** A job reached its handler with a payload its declaration refuses: a bug of the producer, never made right by waiting. */
    PayloadInvalid = "VECTOR_SYNC_PAYLOAD_INVALID",
}

/** How each vector-sync code travels. */
export const VECTOR_SYNC_ERROR_KINDS: Record<VectorSyncErrorCode, ErrorKind> = {
    [VectorSyncErrorCode.EmbeddingUnavailable]: "unavailable",
    [VectorSyncErrorCode.IndexUnavailable]: "unavailable",
    [VectorSyncErrorCode.PayloadInvalid]: "invalid",
}

/** The one error class of the vector-sync capability. */
export class VectorSyncError extends DomainError<VectorSyncErrorCode> {}
