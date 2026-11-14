import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the shop-document critic of the Second Brain. */
export enum DossierReviewErrorCode {
    /** The point of the document critique, or the document, does not exist in this workspace. */
    CriticNotFound = "DOSSIER_REVIEW_CRITIC_NOT_FOUND",
    /** The point was already answered, skipped, or left the document. */
    CriticDecided = "DOSSIER_REVIEW_CRITIC_DECIDED",
    /** The answer is not one the point offers, or it needs a value. */
    CriticAnswerInvalid = "DOSSIER_REVIEW_CRITIC_ANSWER_INVALID",
    /** The critique of the document is running; ask again when it ends. */
    CriticRunning = "DOSSIER_REVIEW_CRITIC_RUNNING",
    /** The critic model could not be reached (a timeout, a provider error): it heals, so the job's ladder tries the critique again. */
    ModelUnavailable = "DOSSIER_REVIEW_MODEL_UNAVAILABLE",
    /** The critic model answered nothing readable for a stretch that cannot be narrowed: the same prompt gets the same answer, so no retry helps. */
    ModelRefused = "DOSSIER_REVIEW_MODEL_REFUSED",
    /** A review job reached its runner with a payload its declaration refuses: a bug of the producer. */
    PayloadInvalid = "DOSSIER_REVIEW_PAYLOAD_INVALID",
}

/** How each critic code travels. */
export const DOSSIER_REVIEW_ERROR_KINDS: Record<DossierReviewErrorCode, ErrorKind> = {
    [DossierReviewErrorCode.CriticNotFound]: "not-found",
    [DossierReviewErrorCode.CriticDecided]: "conflict",
    [DossierReviewErrorCode.CriticAnswerInvalid]: "invalid",
    [DossierReviewErrorCode.CriticRunning]: "conflict",
    [DossierReviewErrorCode.ModelUnavailable]: "unavailable",
    [DossierReviewErrorCode.ModelRefused]: "invalid",
    [DossierReviewErrorCode.PayloadInvalid]: "invalid",
}

/** The one error class of the shop-document critic. */
export class DossierReviewError extends DomainError<DossierReviewErrorCode> {}
