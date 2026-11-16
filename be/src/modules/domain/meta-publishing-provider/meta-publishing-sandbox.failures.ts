import { MetaPublishingError, MetaPublishingErrorCode } from "@modules/integrations/meta-publishing"
import { metaPublishingFailureOf } from "./meta-publishing-failure.policy"

/** What the sandbox says when a call times out (the cause the live client wraps from its transport). */
const NO_ANSWER = "sandbox: no answer in time"

/** The seconds the sandbox's rate refusal asks the caller to wait (the live client reads them from the answer's header). */
const RETRY_AFTER_SECONDS = 30

/**
 * The failure the live adapters throw for a Meta publishing client failure of that code: the SAME `MetaPublishingError` the client throws
 * (`meta-publishing.client.ts` `answeredFailure`: params `status`, Graph's `code`, `detail`), passed through the live adapters' own mapping
 * (`metaPublishingFailureOf`), so the class, the code, the refusal reason and the proof (`not_sent` / `unknown`) are the live ones by
 * construction. The sandbox services build no Meta error themselves: they reach no integration.
 */
const failureOf = (code: MetaPublishingErrorCode, params: Readonly<Record<string, string | number>> = {}, cause?: unknown): Error => {
    const failure = metaPublishingFailureOf(new MetaPublishingError({ code, params, ...(cause === undefined ? {} : { cause }) }))
    return failure instanceof Error ? failure : new Error(NO_ANSWER)
}

/** Graph answered its rate limit (code 4, 429): nothing was done (proof `not_sent`); the client reads `retryAfterSeconds` from the header. */
export const metaPublishingRateLimited = (): Error =>
    failureOf(MetaPublishingErrorCode.RateLimited, { status: 429, code: 4, detail: "", retryAfterSeconds: RETRY_AFTER_SECONDS })

/** Graph answered an outage (code 2, a 5xx): Meta may have acted (proof `unknown`). */
export const metaPublishingServerError = (): Error => failureOf(MetaPublishingErrorCode.Failed, { status: 503, code: 2, detail: "" })

/** No answer arrived (a network cut or a timeout): the request may have left (proof `unknown`). */
export const metaPublishingUnreachable = (): Error => failureOf(MetaPublishingErrorCode.Unreachable, {}, new Error(NO_ANSWER))
