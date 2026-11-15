/*
 * What the model provider's sandbox THROWS: exactly the classes of failure the live endpoint's client throws, by the names the model door
 * reads (`AiService.failureOfThrow`: `TimeoutError` / `AbortError` -> `timeout`, anything else -> `provider`). They are no DomainError on
 * purpose: a DomainError is NIVO's own refusal, and the live endpoint never throws one for a deadline or a 5xx. Each carries the runner's
 * mark `sent: false` (`NotSentFailure`): the sandbox failed the call itself and no request left, so the model door books nothing for it.
 */
import type { NotSentFailure } from "@modules/integrations/ai"

/** The deadline of the call passed before the model answered (the live client's `TimeoutError`). */
export class ModelSandboxTimeoutError extends Error implements NotSentFailure {
    override readonly name = "TimeoutError"

    /** No request of the call left: the sandbox answered it. */
    readonly sent = false

    constructor() {
        super("NIVO Sandbox: the model did not answer before the deadline")
    }
}

/** The provider answered a server error (the live SDK's `InternalServerError`, HTTP 503). */
export class ModelSandboxProviderError extends Error implements NotSentFailure {
    override readonly name = "InternalServerError"

    /** No request of the call left: the sandbox answered it. */
    readonly sent = false

    /** The HTTP status the provider answered. */
    readonly status = 503

    constructor() {
        super("NIVO Sandbox: the model provider answered 503")
    }
}

/**
 * The provider answered 429 (the live SDKs' `RateLimitError`: `@anthropic-ai/sdk` and `openai` both name the class so and carry the
 * status): the model door reads any non-deadline throw as a failed try `provider`, retried after the pause.
 */
export class ModelSandboxRateLimitError extends Error implements NotSentFailure {
    override readonly name = "RateLimitError"

    /** No request of the call left: the sandbox answered it. */
    readonly sent = false

    /** The HTTP status the provider answered. */
    readonly status = 429

    constructor() {
        super("NIVO Sandbox: the model provider answered 429")
    }
}

/**
 * The provider refused the request as longer than the model's context (the live SDKs' `BadRequestError`, HTTP 400, Anthropic's
 * `invalid_request_error` "prompt is too long"; the model door logs only the class and the status, never the words). A retry of the same
 * prompt meets the same answer: the tries policy runs out its tries and the step stops.
 */
export class ModelSandboxContextError extends Error implements NotSentFailure {
    override readonly name = "BadRequestError"

    /** No request of the call left: the sandbox answered it. */
    readonly sent = false

    /** The HTTP status the provider answered. */
    readonly status = 400

    constructor() {
        super("NIVO Sandbox: prompt is too long for the model's context")
    }
}
