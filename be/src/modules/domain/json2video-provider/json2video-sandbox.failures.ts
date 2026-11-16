import { Json2videoError, Json2videoErrorCode } from "@modules/integrations/json2video"
import { json2videoFailureOf } from "./json2video-failure.policy"
import { JSON2VIDEO_SANDBOX_AUTH_MESSAGE } from "./json2video-sandbox.catalogue"

/** What the sandbox says when a call gets no answer (the cause the live client wraps from its transport). */
const NO_ANSWER = "sandbox: no answer in time"

/** The seconds a rate refusal asks the caller to wait (the live client reads them from the answer's header). */
const RETRY_AFTER_SECONDS = 30

/**
 * The failure the live adapter throws for a Json2Video client failure of that code: the SAME `Json2videoError` the client throws, passed
 * through the live adapter's own mapping (`json2videoFailureOf`), so the class, the code, the refusal reason and the proof (`not_sent` /
 * `unknown`) are the live ones by construction. The sandbox service builds no Json2Video error itself: it reaches no integration.
 */
const failureOf = (code: Json2videoErrorCode, params: Readonly<Record<string, string | number>> = {}, cause?: unknown): Error => {
    const failure = json2videoFailureOf(new Json2videoError({ code, params, ...(cause === undefined ? {} : { cause }) }))
    return failure instanceof Error ? failure : new Error(NO_ANSWER)
}

/** Json2Video refused the key (401): the refusal `auth_refused`, nothing sent (proof `not_sent`). */
export const json2videoAuthRefused = (): Error => failureOf(Json2videoErrorCode.AuthFailed, { status: 401, detail: JSON2VIDEO_SANDBOX_AUTH_MESSAGE })

/** Json2Video asked the caller to slow down (429): the rate-limit error as it is, nothing sent (proof `not_sent`). */
export const json2videoRateLimited = (): Error => failureOf(Json2videoErrorCode.RateLimited, { status: 429, detail: "", retryAfterSeconds: RETRY_AFTER_SECONDS })

/** Json2Video answered a server failure (5xx): the effect is not known (proof `unknown`). */
export const json2videoServerError = (): Error => failureOf(Json2videoErrorCode.Failed, { status: 503, detail: "" })

/** The API did not answer in time: the effect is not known (proof `unknown`). */
export const json2videoUnreachable = (): Error => failureOf(Json2videoErrorCode.Unreachable, {}, new Error(NO_ANSWER))
