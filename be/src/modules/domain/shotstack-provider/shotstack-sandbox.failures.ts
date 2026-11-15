import { ShotstackError, ShotstackErrorCode } from "@modules/integrations/shotstack"
import { shotstackFailureOf } from "./shotstack-failure.policy"
import { SHOTSTACK_SANDBOX_AUTH_MESSAGE } from "./shotstack-sandbox.catalogue"

/** What the sandbox says when a call gets no answer (the cause the live client wraps from its transport). */
const NO_ANSWER = "sandbox: no answer in time"

/** The seconds a rate refusal asks the caller to wait (the live client reads them from the answer's header). */
const RETRY_AFTER_SECONDS = 30

/**
 * The failure the live adapter throws for a Shotstack client failure of that code: the SAME `ShotstackError` the client throws, passed
 * through the live adapter's own mapping (`shotstackFailureOf`), so the class, the code, the refusal reason and the proof (`not_sent` /
 * `unknown`) are the live ones by construction. The sandbox service builds no Shotstack error itself: it reaches no integration.
 */
const failureOf = (code: ShotstackErrorCode, params: Readonly<Record<string, string | number>> = {}, cause?: unknown): Error => {
    const failure = shotstackFailureOf(new ShotstackError({ code, params, ...(cause === undefined ? {} : { cause }) }))
    return failure instanceof Error ? failure : new Error(NO_ANSWER)
}

/** Shotstack refused the key (401): the refusal `auth_refused`, nothing sent (proof `not_sent`). */
export const shotstackAuthRefused = (): Error => failureOf(ShotstackErrorCode.AuthFailed, { status: 401, detail: SHOTSTACK_SANDBOX_AUTH_MESSAGE })

/** Shotstack asked the caller to slow down (429): the rate-limit error as it is, nothing sent (proof `not_sent`). */
export const shotstackRateLimited = (): Error => failureOf(ShotstackErrorCode.RateLimited, { status: 429, detail: "", retryAfterSeconds: RETRY_AFTER_SECONDS })

/** Shotstack answered a server failure (5xx): the effect is not known (proof `unknown`). */
export const shotstackServerError = (): Error => failureOf(ShotstackErrorCode.Failed, { status: 503, detail: "" })

/** The API did not answer in time: the effect is not known (proof `unknown`). */
export const shotstackUnreachable = (): Error => failureOf(ShotstackErrorCode.Unreachable, {}, new Error(NO_ANSWER))
