import { withProof } from "@modules/domain/provider-registry"
// NEED (google-connections owner): export `GoogleConnectionsError` and its code from the google-connections index; until then it is read from its file.
import { GoogleConnectionsError, GoogleConnectionsErrorCode } from "@modules/domain/google-connections/errors/google-connections.error"
import { GoogleError, GoogleErrorCode } from "@modules/integrations/google"
import { GoogleCalendarError, GoogleCalendarErrorCode } from "@modules/integrations/google-calendar"
import type { ErrorParams } from "@modules/platform/errors"
import { googleCalendarFailureOf } from "./google-calendar-failure.policy"

/*
 * WHAT THE LIVE CALENDAR THROWS FOR EACH ANSWER, built by the live path: a Calendar answer is a `GoogleCalendarError` (the codes and the
 * statuses of `google-calendar.client.ts` `answeredFailure`, Google's errors guide) and goes through `googleCalendarFailureOf`, the same
 * function `GoogleCalendarService.guarded` uses, so the proof (`not_sent` for an answered refusal, `unknown` for a cut or a 5xx) and the
 * typed refusal are the live ones and no case invents either. The sandbox service builds no error itself: it reaches no integration.
 */

const calendarFailure = (code: GoogleCalendarErrorCode, params: ErrorParams): Error => {
    const failure = googleCalendarFailureOf(new GoogleCalendarError({ code, params }))
    return failure instanceof Error ? failure : new Error("calendar failure")
}

/** 401 `authError`: the credential is refused after the one forced refresh (the live `auth_refused`, `not_sent`). */
export const calendarAuthRefused = (): Error =>
    calendarFailure(GoogleCalendarErrorCode.AuthFailed, { status: 401, reason: "authError", detail: "Invalid Credentials" })

/** 404 `notFound`: the calendar or the event is not there (the live `not_found`, `not_sent`). */
export const calendarNotFound = (): Error => calendarFailure(GoogleCalendarErrorCode.NotFound, { status: 404, reason: "notFound", detail: "Not Found" })

/** 409 `duplicate`: an event id that already exists (the live `rejected`, `not_sent`). */
export const calendarDuplicate = (detail: string): Error =>
    calendarFailure(GoogleCalendarErrorCode.Rejected, { status: 409, reason: "duplicate", detail })

/** 429 `rateLimitExceeded`: Calendar throttled the call and did nothing (the live rate limit, `not_sent`: "not now"). */
export const calendarRateLimited = (): Error =>
    calendarFailure(GoogleCalendarErrorCode.RateLimited, { status: 429, reason: "rateLimitExceeded", detail: "Rate Limit Exceeded" })

/** No answer (a network cut or a timeout): the request may have left, so Calendar may or may not have acted (the live `unknown` proof). */
export const calendarNoAnswer = (): Error => calendarFailure(GoogleCalendarErrorCode.Unreachable, {})

/** The stored Google grant was revoked (`invalid_grant`): the token store throws `GOOGLE_CONNECTIONS_LOST`, which the credential service proves `not_sent` (no request left). */
export const calendarGrantRevoked = (): Error => withProof(new GoogleConnectionsError({ code: GoogleConnectionsErrorCode.Lost }), "not_sent")

/** The refresh of the access token could not reach Google: the token store's `GoogleError` Unreachable, proved `not_sent` by the credential service (no Calendar request left). */
export const calendarRefreshUnreachable = (): Error => withProof(new GoogleError({ code: GoogleErrorCode.Unreachable }), "not_sent")
