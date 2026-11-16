import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the sealing capability. */
export enum SealingErrorCode {
    /** The sealing key is not 32 bytes of base64. */
    KeyInvalid = "SEALING_KEY_INVALID",
    /** A sealed text could not be opened with the key: another key, a changed value or an unknown key version. */
    Unreadable = "SEALING_UNREADABLE",
}

/** How each sealing code travels. */
export const SEALING_ERROR_KINDS: Record<SealingErrorCode, ErrorKind> = {
    [SealingErrorCode.KeyInvalid]: "internal",
    [SealingErrorCode.Unreadable]: "internal",
}

/** The one error class of the sealing capability. */
export class SealingError extends DomainError<SealingErrorCode> {}
