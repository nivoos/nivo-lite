/*
 * What the model provider's sandbox THROWS: exactly the classes of failure the live endpoint's client throws, by the names the model door
 * reads (`AiService.failureOfThrow`: `TimeoutError` / `AbortError` -> `timeout`, anything else -> `provider`). They are no DomainError on
 * purpose: a DomainError is NIVO's own refusal, and the live endpoint never throws one for a deadline or a 5xx.
 */

/** The deadline of the call passed before the model answered (the live client's `TimeoutError`). */
export class ModelSandboxTimeoutError extends Error {
    override readonly name = "TimeoutError"

    constructor() {
        super("NIVO Sandbox: the model did not answer before the deadline")
    }
}

/** The provider answered a server error (the live SDK's `InternalServerError`, HTTP 503). */
export class ModelSandboxProviderError extends Error {
    override readonly name = "InternalServerError"

    /** The HTTP status the provider answered. */
    readonly status = 503

    constructor() {
        super("NIVO Sandbox: the model provider answered 503")
    }
}
