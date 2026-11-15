import { CreatomateError, CreatomateErrorCode } from "@modules/integrations/creatomate"
import { creatomateFailureOf } from "./creatomate-failure.policy"
import { CREATOMATE_SANDBOX_AUTH_HINT } from "./creatomate-sandbox.catalogue"

/** What the sandbox says when a call gets no answer (the cause the live client wraps from its transport). */
const NO_ANSWER = "sandbox: no answer in time"

/** The seconds a rate refusal asks the caller to wait (the live client reads them from the answer's header). */
const RETRY_AFTER_SECONDS = 30

/**
 * The failure the live adapter throws for a Creatomate client failure of that code: the SAME `CreatomateError` the client throws, passed
 * through the live adapter's own mapping (`creatomateFailureOf`), so the class, the code, the refusal reason and the proof (`not_sent` /
 * `unknown`) are the live ones by construction. The sandbox service builds no Creatomate error itself: it reaches no integration.
 */
const failureOf = (code: CreatomateErrorCode, params: Readonly<Record<string, string | number>> = {}, cause?: unknown): Error => {
    const failure = creatomateFailureOf(new CreatomateError({ code, params, ...(cause === undefined ? {} : { cause }) }))
    return failure instanceof Error ? failure : new Error(NO_ANSWER)
}

/** Creatomate refused the key (401): the refusal `auth_refused`, nothing sent (proof `not_sent`). */
export const creatomateAuthRefused = (): Error => failureOf(CreatomateErrorCode.AuthFailed, { status: 401, detail: CREATOMATE_SANDBOX_AUTH_HINT })

/** Creatomate asked the caller to slow down (429): the rate-limit error as it is, nothing sent (proof `not_sent`). */
export const creatomateRateLimited = (): Error => failureOf(CreatomateErrorCode.RateLimited, { status: 429, detail: "", retryAfterSeconds: RETRY_AFTER_SECONDS })

/** Creatomate answered a server failure (5xx): the effect is not known (proof `unknown`). */
export const creatomateServerError = (): Error => failureOf(CreatomateErrorCode.Failed, { status: 503, detail: "" })

/** The API did not answer in time: the effect is not known (proof `unknown`). */
export const creatomateUnreachable = (): Error => failureOf(CreatomateErrorCode.Unreachable, {}, new Error(NO_ANSWER))
