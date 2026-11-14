import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the effects capability. */
export enum EffectsErrorCode {
    /** An act outside the database may or may not have happened, and nothing the effect declares can tell: only a person decides. */
    OutcomeUnknown = "EFFECTS_OUTCOME_UNKNOWN",
    /** An effect declared `confirm` was asked to settle a lost act, but its call carries no read to confirm with. */
    ConfirmMissing = "EFFECTS_CONFIRM_MISSING",
    /** A settle inside a transaction named a key that has no intent row: the act was never recorded as begun. */
    IntentMissing = "EFFECTS_INTENT_MISSING",
    /** The effects capability was registered with no connection to hold the ledger table. */
    ConnectionMissing = "EFFECTS_CONNECTION_MISSING",
    /** A ledger row held a state or a kept result of no known shape. */
    LedgerRowRejected = "EFFECTS_LEDGER_ROW_REJECTED",
    /** An act whose answer the caller needs was not made by the effects port: only a `repeatable` effect is made again, so a wiring bug. */
    Unanswered = "EFFECTS_UNANSWERED",
    /** A call keeps a SECRET but the capability was registered with no sealing key. */
    SealingMissing = "EFFECTS_SEALING_MISSING",
}

/** How each effects code travels. */
export const EFFECTS_ERROR_KINDS: Record<EffectsErrorCode, ErrorKind> = {
    [EffectsErrorCode.OutcomeUnknown]: "conflict",
    [EffectsErrorCode.ConfirmMissing]: "internal",
    [EffectsErrorCode.IntentMissing]: "internal",
    [EffectsErrorCode.ConnectionMissing]: "internal",
    [EffectsErrorCode.LedgerRowRejected]: "internal",
    [EffectsErrorCode.Unanswered]: "internal",
    [EffectsErrorCode.SealingMissing]: "internal",
}

/** The one error class of the effects capability. */
export class EffectsError extends DomainError<EffectsErrorCode> {}
