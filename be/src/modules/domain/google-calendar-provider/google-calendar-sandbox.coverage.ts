import type { SandboxCoverage, SandboxRoleCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * GOOGLE CALENDAR'S SANDBOX COVERAGE (SBX standard 2026-11-15), the calendar half of provider key `google` (the ledger half is in
 * `google-connections/google-sandbox.coverage.ts`, YouTube's is another file). Roles: `read` on `busy` (a free / busy window), `act` on
 * `createEvent` / `updateEvent` / `cancelEvent`, `connection` (the Google access). Operation names do not collide inside the key
 * (calendar: busy, createEvent, updateEvent, cancelEvent; ledger: ready, append, void). Words and proofs: `google-calendar.client.ts`
 * (`answeredFailure`), `google-calendar-failure.policy.ts` (`googleCalendarFailureOf`), `google-calendar-credential.service.ts`,
 * `google-tokens.service.ts`; the calendar tools declare neither `repeatable` nor `confirmBy` and no `finalRefusals` (tool-specs.policy.ts
 * `calendarEventCreate` / `Update` / `Cancel` are plain `writeSpec`s).
 */
const noFinal =
    "the calendar tools declare no finalRefusals (tool-specs.policy.ts writeSpec): every refusal Calendar gives (a refused credential, a missing calendar or event, a duplicate id) is one a person can resolve, so it is a stop, never a business answer"
const noConfirm =
    "the calendar tools declare no confirmBy (tool-specs.policy.ts writeSpec) and the tool makes no read after an unknown outcome: an unknown outcome is a stop a person resolves (the free / busy read shows the event)"
const noPartial = "one call makes, changes or cancels exactly one event: it has no parts that could be partly done"

const act = (operation: string, unknownApplied: string, replay: string): SandboxRoleCoverage => ({
    role: "act",
    operation,
    covers: {
        "act.final": { na: noFinal },
        "act.unknown_applied": { cases: [unknownApplied] },
        "act.confirm_read": { na: noConfirm },
        "act.replay": { na: replay },
        "act.partial": { na: noPartial },
    },
})

export const GCAL_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "google",
    roles: [
        {
            role: "read",
            operation: "busy",
            covers: {
                // GCAL-8: freeBusy answers errors[] reason notFound for a calendar the account does not hold (google-calendar.client.ts `googleFreeBusyOf`).
                "read.not_found": { cases: ["GCAL-8"] },
                "read.page": { na: "freeBusy is one POST for one window and answers every busy range of it in one body: Calendar pages no freeBusy answer, so nothing is cut or paged" },
            },
        },
        act(
            "createEvent",
            "GCAL-14",
            "a caller's own event id that already exists is refused 409 duplicate (GCAL-4), never answered with the first result; with no id every call makes a new event, and Calendar takes no other idempotency key",
        ),
        act(
            "updateEvent",
            "GCAL-25",
            "an update sets the same values again and answers the event; Calendar takes no idempotency key, and the same patch twice is the same event, not a replayed first answer",
        ),
        act(
            "cancelEvent",
            "GCAL-26",
            "a cancel made again answers 410 deleted, which the adapter reads as cancelled false (GCAL-6), not the first answer; Calendar takes no idempotency key",
        ),
        {
            role: "connection",
            covers: {
                // 401 after the one forced refresh (google-calendar-credential.service.ts `withToken`): on every operation.
                "connection.credential_refused": { cases: ["GCAL-7", "GCAL-11", "GCAL-15", "GCAL-19"] },
                // invalid_grant at the token store: GOOGLE_CONNECTIONS_LOST, proved not_sent (the account is marked in error until the owner connects again).
                "connection.revoked": { cases: ["GCAL-23"] },
                // The refresh could not reach Google (a GoogleError, proved not_sent). Another worker refreshing at once is not modelled: the token store holds no lock.
                "connection.refresh": { cases: ["GCAL-24"] },
            },
        },
    ],
}
