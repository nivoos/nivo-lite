import { TiktokError, TiktokErrorCode } from "@modules/integrations/tiktok"
import { tiktokFailureOf } from "./tiktok-failure.policy"

/** What the sandbox says when a call times out (the cause the live client wraps from its transport). */
const NO_ANSWER = "sandbox: no answer in time"

/** The seconds the sandbox's rate refusal asks the caller to wait (the live client reads them from the answer's header). */
const RETRY_AFTER_SECONDS = 30

/**
 * The failure the live adapter throws for a TikTok client failure of that code: the SAME `TiktokError` the client throws
 * (`tiktok.client.ts` `answeredFailure`: params `status`, `word`, `detail`), passed through the live adapter's own mapping
 * (`tiktokFailureOf`), so the class, the code, the refusal reason and the proof (`not_sent` / `unknown`) are the live ones by
 * construction. The sandbox service builds no TikTok error itself: it reaches no integration.
 */
const failureOf = (code: TiktokErrorCode, params: Readonly<Record<string, string | number>> = {}, cause?: unknown): Error => {
    const failure = tiktokFailureOf(new TiktokError({ code, params, ...(cause === undefined ? {} : { cause }) }))
    return failure instanceof Error ? failure : new Error(NO_ANSWER)
}

/** TikTok answered 429: nothing was done (proof `not_sent`); the client reads `retryAfterSeconds` from the header. */
export const tiktokRateLimited = (): Error =>
    failureOf(TiktokErrorCode.RateLimited, { status: 429, word: "", detail: "", retryAfterSeconds: RETRY_AFTER_SECONDS })

/** TikTok answered a 5xx: it may have acted (proof `unknown`). */
export const tiktokServerError = (): Error => failureOf(TiktokErrorCode.Failed, { status: 503, word: "", detail: "" })

/** No answer arrived (a network cut or a timeout): the request may have left (proof `unknown`). */
export const tiktokUnreachable = (): Error => failureOf(TiktokErrorCode.Unreachable, {}, new Error(NO_ANSWER))

/** The NIVO TikTok app has no client id / secret on this deployment: refused `not_available` (app client), nothing sent (proof `not_sent`). */
export const tiktokNotConfigured = (): Error => failureOf(TiktokErrorCode.NotConfigured)
