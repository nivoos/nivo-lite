import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the owners capability. */
export enum OwnersErrorCode {
    /** The database did not return the hash of the password it was asked to compute. */
    PasswordNotHashed = "OWNERS_PASSWORD_NOT_HASHED",
    /** The address to rename from has no account. */
    AccountMissing = "OWNERS_ACCOUNT_MISSING",
    /** The address to rename to already belongs to another account. */
    EmailTaken = "OWNERS_EMAIL_TAKEN",
    /** The command's stdin is not the JSON object it takes. */
    InputInvalid = "OWNERS_INPUT_INVALID",
}

/** How each owners code travels. */
export const OWNERS_ERROR_KINDS: Record<OwnersErrorCode, ErrorKind> = {
    [OwnersErrorCode.PasswordNotHashed]: "unavailable",
    [OwnersErrorCode.AccountMissing]: "not-found",
    [OwnersErrorCode.EmailTaken]: "conflict",
    [OwnersErrorCode.InputInvalid]: "invalid",
}

/** The one error class of the owners capability. */
export class OwnersError extends DomainError<OwnersErrorCode> {}
