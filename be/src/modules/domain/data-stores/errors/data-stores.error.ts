import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the data stores capability. */
export enum DataStoresErrorCode {
    /** The workspace the scope names is not found, or its name is held by more than one live workspace. */
    ScopeUnknown = "DATA_STORES_SCOPE_UNKNOWN",
    /** The storage could not be reached or answered something other than a found or an absent object. */
    StorageUnavailable = "DATA_STORES_STORAGE_UNAVAILABLE",
    /** A set door refused a record: it is not of the set's schema (its code is the refusal code a copy reports for the key). */
    RecordInvalid = "DATA_STORES_RECORD_INVALID",
    /** A change of topic, module or visibility alone has no door in this app that keeps the vector index in step. */
    KnowledgeMetaDoor = "DATA_STORES_KNOWLEDGE_META_DOOR_MISSING",
    /** A whole-deployment store was asked for a narrowing (a scope) or a destructive mirror it does not serve. */
    CallUnsupported = "DATA_STORES_CALL_UNSUPPORTED",
}

/** How each data stores code travels. */
export const DATA_STORES_ERROR_KINDS: Record<DataStoresErrorCode, ErrorKind> = {
    [DataStoresErrorCode.ScopeUnknown]: "not-found",
    [DataStoresErrorCode.StorageUnavailable]: "unavailable",
    [DataStoresErrorCode.RecordInvalid]: "invalid",
    [DataStoresErrorCode.KnowledgeMetaDoor]: "unavailable",
    [DataStoresErrorCode.CallUnsupported]: "invalid",
}

/** The one error class of the data stores capability. */
export class DataStoresError extends DomainError<DataStoresErrorCode> {}
