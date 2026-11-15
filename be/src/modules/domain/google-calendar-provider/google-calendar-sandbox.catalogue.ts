import { PROVIDER } from "@nivo-lite/agent-sdk/names"
import type { SandboxCatalogue } from "@modules/domain/provider-sandbox"

/** One event of the fixed week the sandbox calendar holds. */
export interface GoogleCalendarSandboxEvent {
    /** The event id. */
    readonly eventId: string
    /** The title. */
    readonly summary: string
    /** Start, RFC 3339 with an offset. */
    readonly start: string
    /** End, RFC 3339 with an offset. */
    readonly end: string
}

/** The calendar id every account's own calendar answers to when a request names none (Google's own word). */
export const GCAL_SANDBOX_PRIMARY = "primary"

/** The address an event's link starts with; the event id follows. */
export const GCAL_SANDBOX_LINK_BASE = "https://calendar.sandbox.test/event?eid="

/**
 * The events of the account's primary calendar in the fixed week Monday 16 to Sunday 22 November 2026 (Vietnam time, +07:00): what a
 * free / busy read answers and what a change or a cancel can name. Everything outside them is free.
 */
export const GCAL_SANDBOX_EVENTS: ReadonlyArray<GoogleCalendarSandboxEvent> = [
    { eventId: "sbx-evt-giao-ban", summary: "Họp giao ban", start: "2026-11-16T09:00:00+07:00", end: "2026-11-16T10:00:00+07:00" },
    { eventId: "sbx-evt-khach-hang", summary: "Gặp khách hàng", start: "2026-11-17T14:00:00+07:00", end: "2026-11-17T15:30:00+07:00" },
    { eventId: "sbx-evt-nhap-hang", summary: "Nhận hàng nhập", start: "2026-11-18T10:00:00+07:00", end: "2026-11-18T11:00:00+07:00" },
    { eventId: "sbx-evt-dao-tao", summary: "Đào tạo nhân viên", start: "2026-11-19T09:00:00+07:00", end: "2026-11-19T12:00:00+07:00" },
    { eventId: "sbx-evt-kiem-ke", summary: "Kiểm kê cuối tuần", start: "2026-11-20T15:00:00+07:00", end: "2026-11-20T16:00:00+07:00" },
]

/** The duplicate refusal's words: Calendar answers 409 to an event id that already exists. */
export const GCAL_SANDBOX_DUPLICATE_DETAIL = "The requested identifier already exists."

/** The operations of the calendar port, as the sandbox call log and the account's next-case selector name them (the port's own method names). */
export const GCAL_OPERATION = { busy: "busy", create: "createEvent", update: "updateEvent", cancel: "cancelEvent" } as const

/**
 * The ids of the cases an operation's answer is picked by: the account's sticky NEXT CASE of that operation (`state.nextCase`). No calendar
 * id, event id or request word picks a case: whatever the request names, the picked case answers.
 */
export const GCAL_CASE = {
    /** busy: the fixed week (default). */
    week: "GCAL-1",
    /** busy: an empty calendar, the whole window free. */
    empty: "GCAL-2",
    /** createEvent: the event is made (default). */
    created: "GCAL-3",
    /** createEvent: duplicate event id, whatever the id. */
    duplicate: "GCAL-4",
    /** updateEvent: the event is changed (default). */
    updated: "GCAL-5",
    /** cancelEvent: the event is cancelled (default). */
    cancelled: "GCAL-6",
    /** busy: the credential is refused (401). */
    busyAuthRefused: "GCAL-7",
    /** busy: the calendar is not found (404). */
    busyNotFound: "GCAL-8",
    busyRateLimited: "GCAL-9",
    busyNoAnswer: "GCAL-10",
    createAuthRefused: "GCAL-11",
    createRateLimited: "GCAL-12",
    createNoAnswer: "GCAL-13",
    /** createEvent: no answer, but the event WAS made (Calendar took it and the answer was lost). */
    createAppliedNoAnswer: "GCAL-14",
    updateAuthRefused: "GCAL-15",
    updateRateLimited: "GCAL-16",
    updateNoAnswer: "GCAL-17",
    updateNotFound: "GCAL-18",
    cancelAuthRefused: "GCAL-19",
    cancelRateLimited: "GCAL-20",
    cancelNoAnswer: "GCAL-21",
    cancelNotFound: "GCAL-22",
    /** busy: the stored grant was revoked (`invalid_grant`): no request leaves. */
    busyGrantRevoked: "GCAL-23",
    /** busy: the token refresh cannot reach Google: no request leaves. */
    busyRefreshUnreachable: "GCAL-24",
    /** updateEvent: no answer, but the event WAS changed. */
    updateAppliedNoAnswer: "GCAL-25",
    /** cancelEvent: no answer, but the event WAS cancelled. */
    cancelAppliedNoAnswer: "GCAL-26",
} as const

/**
 * The hardcoded catalogue of the Google Calendar sandbox (ruling R60): ids `GCAL-<n>`, identical on every machine. Every case is picked by the
 * account's NEXT CASE of its operation (R62); the error shapes and words come from `google-calendar.client.ts`,
 * `google-calendar-failure.policy.ts` and Google's errors guide (quoted in `google-calendar-sandbox.failures.ts`). Exactly one default per
 * operation, tagged `ok`.
 */
export const GCAL_SANDBOX_CATALOGUE: SandboxCatalogue = {
    provider: PROVIDER.google,
    cases: [
        { id: GCAL_CASE.week, label: "The primary calendar of the fixed week 16-22 Nov 2026 is busy at five fixed events; everything else in the window is free", operation: GCAL_OPERATION.busy, outcome: "ok", default: true },
        { id: GCAL_CASE.empty, label: "The calendar holds no event: the whole window is free", operation: GCAL_OPERATION.busy, outcome: "ok" },
        {
            id: GCAL_CASE.created,
            label: "An event made is kept in state: confirmed, with a link, and busy in every later free / busy read until cancelled (a caller's event id that already exists is refused rejected: duplicate, the live 409; overlapping times are not refused, as Calendar does not)",
            operation: GCAL_OPERATION.create,
            outcome: "ok",
            default: true,
        },
        { id: GCAL_CASE.duplicate, label: "An event made under an id that already exists is refused rejected: duplicate (the live 409), whatever the id", operation: GCAL_OPERATION.create, outcome: "refused" },
        { id: GCAL_CASE.updated, label: "An event changed answers its new title and times; an event the calendar does not hold (or one cancelled) answers not found", operation: GCAL_OPERATION.update, outcome: "ok", default: true },
        { id: GCAL_CASE.cancelled, label: "An event cancelled answers cancelled true; cancelled again, cancelled false (already gone, the live 410); an unknown one answers not found", operation: GCAL_OPERATION.cancel, outcome: "ok", default: true },
        { id: GCAL_CASE.busyAuthRefused, label: "The free / busy read is refused: the credential expired (401, auth refused, nothing done)", operation: GCAL_OPERATION.busy, outcome: "refused" },
        { id: GCAL_CASE.busyNotFound, label: "The free / busy read of a calendar the account does not hold is refused not found (404)", operation: GCAL_OPERATION.busy, outcome: "refused" },
        { id: GCAL_CASE.busyRateLimited, label: "Calendar throttles the free / busy read (429 rateLimitExceeded): nothing done, a retry may pass", operation: GCAL_OPERATION.busy, outcome: "transient" },
        { id: GCAL_CASE.busyNoAnswer, label: "The free / busy read never answers (a network cut): no answer", operation: GCAL_OPERATION.busy, outcome: "timeout" },
        { id: GCAL_CASE.createAuthRefused, label: "The event make is refused: the credential expired (401, auth refused, nothing made)", operation: GCAL_OPERATION.create, outcome: "refused" },
        { id: GCAL_CASE.createRateLimited, label: "Calendar throttles the event make (429 rateLimitExceeded): nothing made, a retry may pass", operation: GCAL_OPERATION.create, outcome: "transient" },
        { id: GCAL_CASE.createNoAnswer, label: "The event make never answers and nothing was made: no answer, the outcome unknown", operation: GCAL_OPERATION.create, outcome: "timeout" },
        { id: GCAL_CASE.createAppliedNoAnswer, label: "The event make never answers but the event WAS made (kept in state, busy in the next free / busy read): no answer, the outcome unknown", operation: GCAL_OPERATION.create, outcome: "timeout" },
        { id: GCAL_CASE.updateAuthRefused, label: "The event change is refused: the credential expired (401, auth refused, nothing changed)", operation: GCAL_OPERATION.update, outcome: "refused" },
        { id: GCAL_CASE.updateRateLimited, label: "Calendar throttles the event change (429 rateLimitExceeded): nothing changed, a retry may pass", operation: GCAL_OPERATION.update, outcome: "transient" },
        { id: GCAL_CASE.updateNoAnswer, label: "The event change never answers: no answer, the outcome unknown", operation: GCAL_OPERATION.update, outcome: "timeout" },
        { id: GCAL_CASE.updateNotFound, label: "The event to change is not found (404), whatever its id", operation: GCAL_OPERATION.update, outcome: "refused" },
        { id: GCAL_CASE.cancelAuthRefused, label: "The event cancel is refused: the credential expired (401, auth refused, nothing cancelled)", operation: GCAL_OPERATION.cancel, outcome: "refused" },
        { id: GCAL_CASE.cancelRateLimited, label: "Calendar throttles the event cancel (429 rateLimitExceeded): nothing cancelled, a retry may pass", operation: GCAL_OPERATION.cancel, outcome: "transient" },
        { id: GCAL_CASE.cancelNoAnswer, label: "The event cancel never answers: no answer, the outcome unknown", operation: GCAL_OPERATION.cancel, outcome: "timeout" },
        { id: GCAL_CASE.cancelNotFound, label: "The event to cancel is not found (404), whatever its id", operation: GCAL_OPERATION.cancel, outcome: "refused" },
        {
            id: GCAL_CASE.busyGrantRevoked,
            label: "The Google access was revoked at Google (invalid_grant): the token store finds the grant lost and no request leaves (not sent); every call is refused until the owner connects again",
            operation: GCAL_OPERATION.busy,
            outcome: "refused",
        },
        { id: GCAL_CASE.busyRefreshUnreachable, label: "The token refresh cannot reach Google: no request leaves (not sent), a retry may pass", operation: GCAL_OPERATION.busy, outcome: "transient" },
        { id: GCAL_CASE.updateAppliedNoAnswer, label: "The event change never answers but the event WAS changed (kept in state): no answer, the outcome unknown", operation: GCAL_OPERATION.update, outcome: "timeout" },
        { id: GCAL_CASE.cancelAppliedNoAnswer, label: "The event cancel never answers but the event WAS cancelled (kept in state): no answer, the outcome unknown", operation: GCAL_OPERATION.cancel, outcome: "timeout" },
    ],
}
