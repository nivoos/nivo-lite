import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the webhook-connections capability. */
export enum WebhookConnectionsErrorCode {
    /** No event was picked. */
    EventsEmpty = "WEBHOOK_CONNECTIONS_EVENTS_EMPTY",
    /** The connection name is shorter than two characters. */
    NameInvalid = "WEBHOOK_CONNECTIONS_NAME_INVALID",
    /** The address cannot be a delivery target. */
    UrlRefused = "WEBHOOK_CONNECTIONS_URL_REFUSED",
    /** The deployment has no signing key for outgoing webhooks. */
    SigningUnavailable = "WEBHOOK_CONNECTIONS_SIGNING_UNAVAILABLE",
    /** The connection holds no webhook address. */
    NoUrl = "WEBHOOK_CONNECTIONS_NO_URL",
    /** The receiver did not accept a delivery yet (no answer, a rate limit or a server error); the runner retries it on its ladder. */
    ReceiverUnavailable = "WEBHOOK_CONNECTIONS_RECEIVER_UNAVAILABLE",
    /** The receiver answered the delivery with a refusal no retry changes (a 4xx other than a timeout or a rate limit): a dead letter until a person fixes the receiver and resumes. */
    ReceiverRefused = "WEBHOOK_CONNECTIONS_RECEIVER_REFUSED",
    /** The app composed no outgoing port for this provider: a wiring defect, a dead letter (class config). */
    PortMissing = "WEBHOOK_CONNECTIONS_CONFIG_NO_PORT",
}

/** How each webhook-connections code travels. */
export const WEBHOOK_CONNECTIONS_ERROR_KINDS: Record<WebhookConnectionsErrorCode, ErrorKind> = {
    [WebhookConnectionsErrorCode.EventsEmpty]: "invalid",
    [WebhookConnectionsErrorCode.NameInvalid]: "invalid",
    [WebhookConnectionsErrorCode.UrlRefused]: "invalid",
    [WebhookConnectionsErrorCode.SigningUnavailable]: "unavailable",
    [WebhookConnectionsErrorCode.NoUrl]: "not-found",
    [WebhookConnectionsErrorCode.ReceiverUnavailable]: "unavailable",
    [WebhookConnectionsErrorCode.ReceiverRefused]: "invalid",
    [WebhookConnectionsErrorCode.PortMissing]: "unavailable",
}

/** The one error class of the webhook-connections capability. */
export class WebhookConnectionsError extends DomainError<WebhookConnectionsErrorCode> {}
