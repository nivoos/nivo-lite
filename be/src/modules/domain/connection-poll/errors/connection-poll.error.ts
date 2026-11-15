import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the connection-poll capability. */
export enum ConnectionPollErrorCode {
    /** The provider's rate limit leaves no call for this connection yet: the poll ends and is planned again once the window named in the params as `waitMs` has passed (information for the schedule, not a failure of the provider). */
    Deferred = "CONNECTION_POLL_DEFERRED",
    /** A live account's provider has no poll receiver registered although the schedule holds it: a wiring error. */
    ReceiverMissing = "CONNECTION_POLL_RECEIVER_MISSING",
}

/** How each connection-poll code travels. */
export const CONNECTION_POLL_ERROR_KINDS: Record<ConnectionPollErrorCode, ErrorKind> = {
    [ConnectionPollErrorCode.Deferred]: "rate-limited",
    [ConnectionPollErrorCode.ReceiverMissing]: "internal",
}

/** The one error class of the connection-poll capability. */
export class ConnectionPollError extends DomainError<ConnectionPollErrorCode> {}
