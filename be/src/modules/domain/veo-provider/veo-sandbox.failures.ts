import { VeoError, VeoErrorCode } from "@modules/integrations/veo"
import { veoFailureOf } from "./veo-failure.policy"
import { VEO_SANDBOX_AUTH_MESSAGE } from "./veo-sandbox.catalogue"

/** What the sandbox says when a call gets no answer (the cause the live client wraps from its transport). */
const NO_ANSWER = "sandbox: no answer in time"

/** The seconds a rate refusal asks the caller to wait (the live client reads them from the answer's header). */
const RETRY_AFTER_SECONDS = 30

/**
 * The failure the live adapter throws for a Veo client failure of that code: the SAME `VeoError` the client throws, passed
 * through the live adapter's own mapping (`veoFailureOf`), so the class, the code, the refusal reason and the proof (`not_sent` /
 * `unknown`) are the live ones by construction. The sandbox service builds no Veo error itself: it reaches no integration.
 */
const failureOf = (code: VeoErrorCode, params: Readonly<Record<string, string | number>> = {}, cause?: unknown): Error => {
    const failure = veoFailureOf(new VeoError({ code, params, ...(cause === undefined ? {} : { cause }) }))
    return failure instanceof Error ? failure : new Error(NO_ANSWER)
}

/** Veo refused the key (403): the refusal `auth_refused`, nothing sent (proof `not_sent`). */
export const veoAuthRefused = (): Error => failureOf(VeoErrorCode.AuthFailed, { status: 403, word: "PERMISSION_DENIED", detail: VEO_SANDBOX_AUTH_MESSAGE })

/** Veo asked the caller to slow down (429): the rate-limit error as it is, nothing sent (proof `not_sent`). */
export const veoRateLimited = (): Error => failureOf(VeoErrorCode.RateLimited, { status: 429, word: "RESOURCE_EXHAUSTED", detail: "", retryAfterSeconds: RETRY_AFTER_SECONDS })

/** Veo answered a server failure (5xx): the effect is not known (proof `unknown`). */
export const veoServerError = (): Error => failureOf(VeoErrorCode.Failed, { status: 503, word: "UNAVAILABLE", detail: "" })

/** The API did not answer in time: the effect is not known (proof `unknown`). */
export const veoUnreachable = (): Error => failureOf(VeoErrorCode.Unreachable, {}, new Error(NO_ANSWER))
