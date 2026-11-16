import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the knowledge capability. */
export enum KnowledgeErrorCode {
    /** The agent the question is asked as does not exist. */
    ModuleUnknown = "KNOWLEDGE_MODULE_UNKNOWN",
    /** The embeddings provider could not be reached; the job is retried. */
    EmbeddingUnavailable = "KNOWLEDGE_EMBEDDING_UNAVAILABLE",
    /** A job reached its processor with a payload its declaration refuses: a bug of the producer, never made right by waiting. */
    PayloadInvalid = "KNOWLEDGE_PAYLOAD_INVALID",
    /** A source cannot be read or has nothing to index (an unsupported or damaged file, a password, no text, no passage): the input is wrong, so no retry fixes it; the source row already holds the stored note. */
    SourceRefused = "KNOWLEDGE_SOURCE_REFUSED",
}

/** How each knowledge code travels. */
export const KNOWLEDGE_ERROR_KINDS: Record<KnowledgeErrorCode, ErrorKind> = {
    [KnowledgeErrorCode.ModuleUnknown]: "invalid",
    [KnowledgeErrorCode.EmbeddingUnavailable]: "unavailable",
    [KnowledgeErrorCode.PayloadInvalid]: "invalid",
    [KnowledgeErrorCode.SourceRefused]: "invalid",
}

/** The one error class of the knowledge capability. */
export class KnowledgeError extends DomainError<KnowledgeErrorCode> {}
