import { withProof } from "@modules/domain/provider-registry"
// NEED (google-connections owner): export `GoogleConnectionsError` and its code from the google-connections index; until then it is read from its file.
import { GoogleConnectionsError, GoogleConnectionsErrorCode } from "@modules/domain/google-connections/errors/google-connections.error"
import { GoogleError, GoogleErrorCode } from "@modules/integrations/google"
import { YoutubeError, YoutubeErrorCode } from "@modules/integrations/youtube"
import { youtubeFailureOf } from "./youtube-failure.policy"

/** What the sandbox says when a call times out (the cause the live client wraps from its transport). */
const NO_ANSWER = "sandbox: no answer in time"

/** The seconds the sandbox's rate refusal asks the caller to wait (the live client reads them from the answer's header). */
const RETRY_AFTER_SECONDS = 30

/**
 * The failure the live adapter throws for a YouTube client failure of that code: the SAME `YoutubeError` the client throws
 * (`youtube.client.ts` `answeredFailure`: params `status`, `reason`, `detail`), passed through the live adapter's own mapping
 * (`youtubeFailureOf`), so the class, the code, the refusal reason and the proof (`not_sent` / `unknown`) are the live ones by
 * construction. The sandbox service builds no YouTube error itself: it reaches no integration.
 */
const failureOf = (code: YoutubeErrorCode, params: Readonly<Record<string, string | number>> = {}, cause?: unknown): Error => {
    const failure = youtubeFailureOf(new YoutubeError({ code, params, ...(cause === undefined ? {} : { cause }) }))
    return failure instanceof Error ? failure : new Error(NO_ANSWER)
}

/** The Data API's quota or rate answer (reason `quotaExceeded`, one of the documented rate reasons): nothing was done (proof `not_sent`). */
export const youtubeQuotaExceeded = (): Error =>
    failureOf(YoutubeErrorCode.RateLimited, { status: 403, reason: "quotaExceeded", detail: "", retryAfterSeconds: RETRY_AFTER_SECONDS })

/** The daily upload limit of the channel (reason `uploadLimitExceeded`, a documented content refusal): the live `rejected`, nothing done (proof `not_sent`). */
export const youtubeUploadLimitExceeded = (): Error =>
    failureOf(YoutubeErrorCode.Rejected, { status: 400, reason: "uploadLimitExceeded", detail: "" })

/** The Data API answered a 5xx: it may have acted (proof `unknown`). */
export const youtubeServerError = (): Error => failureOf(YoutubeErrorCode.Failed, { status: 503, reason: "", detail: "" })

/** No answer arrived (a network cut or a timeout): the request may have left (proof `unknown`). */
export const youtubeUnreachable = (): Error => failureOf(YoutubeErrorCode.Unreachable, {}, new Error(NO_ANSWER))

/** The stored Google grant was revoked (`invalid_grant`): the token store throws `GOOGLE_CONNECTIONS_LOST`, which the credential service proves `not_sent` (no request left). */
export const youtubeGrantRevoked = (): Error => withProof(new GoogleConnectionsError({ code: GoogleConnectionsErrorCode.Lost }), "not_sent")

/** The refresh of the access token could not reach Google: the token store's `GoogleError` Unreachable, proved `not_sent` by the credential service (no YouTube request left). */
export const youtubeRefreshUnreachable = (): Error => withProof(new GoogleError({ code: GoogleErrorCode.Unreachable }), "not_sent")
