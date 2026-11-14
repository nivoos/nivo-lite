import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the channels capability. */
export enum ChannelsErrorCode {
    /** The connection does not exist, is disconnected, belongs to another workspace or is not of the expected provider. */
    ConnectionNotFound = "CHANNELS_CONNECTION_NOT_FOUND",
    /** The stored credential could not be read as the provider's document. */
    SecretUnreadable = "CHANNELS_SECRET_UNREADABLE",
    /** The Zalo connection holds no tokens yet: the owner must authorize first. */
    ZaloNotAuthorized = "CHANNELS_ZALO_NOT_AUTHORIZED",
    /** Another worker is refreshing the same Zalo tokens; try again shortly. */
    ZaloRefreshBusy = "CHANNELS_ZALO_REFRESH_BUSY",
    /** The authorization return carries a state that does not match a started authorization. */
    ZaloStateRejected = "CHANNELS_ZALO_STATE_REJECTED",
    /** The started authorization is older than its allowed time. */
    ZaloStateExpired = "CHANNELS_ZALO_STATE_EXPIRED",
    /** The pair of tokens an exchange with Zalo kept on the effect ledger cannot be opened or read: the key that sealed it changed or the row was altered. */
    ZaloKeptPairUnreadable = "CHANNELS_ZALO_KEPT_PAIR_UNREADABLE",
    /** A wizard step could not be completed after its tries; the owner asks again, or the stopped work is resumed. */
    WizardStopped = "CHANNELS_WIZARD_STOPPED",
    /** A job reached its domain method with a payload that is not the one its declaration guards: a producer wrote a wrong job. */
    PayloadInvalid = "CHANNELS_PAYLOAD_INVALID",
    /**
     * The customer send's ONE "nothing was sent, try later" answer, whatever the channel: the provider said it is not taking the message
     * for now (busy, a rate or quota, a window closed for the moment) before anything went out. Params: `retryAfterSeconds` when the
     * provider named a wait, `reason` = the provider's own word for the log. Kind `unavailable`: the runner retries the step.
     */
    SendUnavailable = "CHANNELS_SEND_UNAVAILABLE",
}

/** How each channels code travels. */
export const CHANNELS_ERROR_KINDS: Record<ChannelsErrorCode, ErrorKind> = {
    [ChannelsErrorCode.ConnectionNotFound]: "not-found",
    [ChannelsErrorCode.SecretUnreadable]: "internal",
    [ChannelsErrorCode.ZaloNotAuthorized]: "invalid",
    [ChannelsErrorCode.ZaloRefreshBusy]: "unavailable",
    [ChannelsErrorCode.ZaloStateRejected]: "forbidden",
    [ChannelsErrorCode.ZaloStateExpired]: "conflict",
    [ChannelsErrorCode.ZaloKeptPairUnreadable]: "internal",
    [ChannelsErrorCode.WizardStopped]: "unavailable",
    [ChannelsErrorCode.PayloadInvalid]: "invalid",
    [ChannelsErrorCode.SendUnavailable]: "unavailable",
}

/** The one error class of the channels capability. */
export class ChannelsError extends DomainError<ChannelsErrorCode> {}
