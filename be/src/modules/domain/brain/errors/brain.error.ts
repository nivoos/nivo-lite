import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the brain capability. */
export enum BrainErrorCode {
    /** The model could not be reached (a timeout, a provider error): the runner retries the job on its ladder. */
    ModelUnavailable = "BRAIN_MODEL_UNAVAILABLE",
    /** The model answered nothing for a call whose prompt would get the same answer again: a refusal no retry can fix. */
    ModelRefused = "BRAIN_MODEL_REFUSED",
    /** No model endpoint is configured: nothing can read or judge until a setting is made. */
    ModelUnconfigured = "BRAIN_CONFIG_MODEL_UNCONFIGURED",
    /** A job reached its handler with a payload its declaration refuses: a bug of the producer, never made right by waiting. */
    PayloadInvalid = "BRAIN_PAYLOAD_INVALID",
    /** The caller asked for a command they never made. */
    CommandNotFound = "BRAIN_COMMAND_NOT_FOUND",
    /** Facts are applied together only from a document kept internal: a bulk path never makes anything public. */
    BulkNeedsInternal = "BRAIN_BULK_NEEDS_INTERNAL",
    /** A validity window that ends before (or when) it starts. */
    WindowInvalid = "BRAIN_WINDOW_INVALID",
    /**
     * The guard of an automatic write, run under the workspace's in-force lock, found a value for the key in force since its verdict was
     * read: the same one (`joined`) or one that argues with it (`raced`). Nothing was written; the settle that threw it catches it.
     */
    SettleLostRace = "BRAIN_SETTLE_LOST_RACE",
    /**
     * The guard of an automatic write found, in the transaction of the write, that the document the truth is read from was deleted
     * meanwhile. Nothing was written; the settle that threw it catches it and the job ends `origin_gone`.
     */
    SettleOriginGone = "BRAIN_SETTLE_ORIGIN_GONE",
}

/** How each brain code travels. */
export const BRAIN_ERROR_KINDS: Record<BrainErrorCode, ErrorKind> = {
    [BrainErrorCode.ModelUnavailable]: "unavailable",
    [BrainErrorCode.ModelRefused]: "invalid",
    [BrainErrorCode.ModelUnconfigured]: "internal",
    [BrainErrorCode.PayloadInvalid]: "invalid",
    [BrainErrorCode.CommandNotFound]: "not-found",
    [BrainErrorCode.BulkNeedsInternal]: "conflict",
    [BrainErrorCode.WindowInvalid]: "invalid",
    [BrainErrorCode.SettleLostRace]: "conflict",
    [BrainErrorCode.SettleOriginGone]: "conflict",
}

/** The one error class of the brain capability. */
export class BrainError extends DomainError<BrainErrorCode> {}
