import { ElevenlabsError, ElevenlabsErrorCode } from "@modules/integrations/elevenlabs"
import { elevenLabsFailureOf } from "./elevenlabs-failure.policy"
import { ELEVENLABS_SANDBOX_AUTH_MESSAGE } from "./elevenlabs-sandbox.catalogue"

/** What the sandbox says when a call gets no answer (the cause the live client wraps from its transport). */
const NO_ANSWER = "sandbox: no answer in time"

/** The seconds a rate refusal asks the caller to wait (the live client reads them from the answer's header). */
const RETRY_AFTER_SECONDS = 30

/**
 * The failure the live adapter throws for an ElevenLabs client failure of that code: the SAME `ElevenlabsError` the client throws, passed
 * through the live adapter's own mapping (`elevenLabsFailureOf`), so the class, the code, the refusal reason and the proof (`not_sent` /
 * `unknown`) are the live ones by construction. The sandbox service builds no ElevenLabs error itself: it reaches no integration.
 */
const failureOf = (code: ElevenlabsErrorCode, params: Readonly<Record<string, string | number>> = {}, cause?: unknown): Error => {
    const failure = elevenLabsFailureOf(new ElevenlabsError({ code, params, ...(cause === undefined ? {} : { cause }) }))
    return failure instanceof Error ? failure : new Error(NO_ANSWER)
}

/** ElevenLabs refused the key (401): the refusal `auth_refused`, nothing sent (proof `not_sent`). */
export const elevenLabsAuthRefused = (): Error => failureOf(ElevenlabsErrorCode.AuthFailed, { status: 401, detail: ELEVENLABS_SANDBOX_AUTH_MESSAGE })

/** ElevenLabs asked the caller to slow down (429): the rate-limit error as it is, nothing sent (proof `not_sent`). */
export const elevenLabsRateLimited = (): Error => failureOf(ElevenlabsErrorCode.RateLimited, { status: 429, detail: "", retryAfterSeconds: RETRY_AFTER_SECONDS })

/** ElevenLabs answered a server failure (5xx): the effect is not known (proof `unknown`). */
export const elevenLabsServerError = (): Error => failureOf(ElevenlabsErrorCode.Failed, { status: 503, detail: "" })

/** The API did not answer in time: the effect is not known (proof `unknown`). */
export const elevenLabsUnreachable = (): Error => failureOf(ElevenlabsErrorCode.Unreachable, {}, new Error(NO_ANSWER))
