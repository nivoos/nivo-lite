import type { SandboxCoverage, SandboxRoleCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * THE GOOGLE LEDGER'S SANDBOX COVERAGE (SBX standard 2026-11-15), the ledger half of provider key `google` (Calendar's half is in
 * `google-calendar-provider/google-calendar-sandbox.coverage.ts`). The ledger is a Google spreadsheet the workspace chose, a copy that only
 * grows (`google-ledger.service.ts`): `ready` is a read (is a ledger sheet told for the account), `append` and `void` are acts (one appended
 * row each), `connection` is the Google access. Operations: ready, append, void (no collision with Calendar's).
 */
const noFinal =
    "the ledger tools declare no finalRefusals: a sheet or access Google refuses is the refused ledger connection, which only the owner can cure, so it is a stop, never a business answer"
const noConfirm = "the ledger never reads a cell back (google-ledger.service.ts: a copy that only grows) and the ledger tool declares no confirmBy, so there is no read that could tell whether an unanswered row is there"
const noReplay = "a repeat appends another row: Google takes no idempotency key and nothing at the port dedupes (the tool's once-per-key ledger proves the write repeatable)"
const noPartial = "one call appends one row in one append request (the header row first is part of the same request): it has no parts that could be partly done"

const write = (operation: string, unknownApplied: string): SandboxRoleCoverage => ({
    role: "act",
    operation,
    covers: {
        "act.final": { na: noFinal },
        "act.unknown_applied": { cases: [unknownApplied] },
        "act.confirm_read": { na: noConfirm },
        "act.replay": { na: noReplay },
        "act.partial": { na: noPartial },
    },
})

export const GOOGLE_LEDGER_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "google",
    roles: [
        {
            role: "read",
            operation: "ready",
            covers: {
                // GOOGLE-LEDGER-2: no ledger sheet was told for the account (`ledgerKeeperOf` finds none): not ready.
                "read.not_found": { cases: ["GOOGLE-LEDGER-2"] },
                "read.page": { na: "ready answers one yes or no from the account's own connection rows: nothing is listed or paged" },
                "read.refused": { na: "ready reads the account's connection rows in NIVO's own database and calls no outside system: nothing outside can refuse it" },
                "read.transient": { na: "ready reads the account's connection rows in NIVO's own database and calls no outside system: nothing outside can say not now" },
                "read.timeout": { na: "ready reads the account's connection rows in NIVO's own database and calls no outside system: nothing outside can fail to answer" },
            },
        },
        write("append", "GOOGLE-LEDGER-11"),
        write("void", "GOOGLE-LEDGER-12"),
        {
            role: "connection",
            covers: {
                // isRefusedLedger: a 400/401/403/404 from Google or a lost / missing / unconfigured grant is the refused ledger connection (LEDGER-4 on append, -8 on void).
                "connection.credential_refused": { cases: ["GOOGLE-LEDGER-4", "GOOGLE-LEDGER-8"] },
                "connection.revoked": { cases: ["GOOGLE-LEDGER-4"] },
                // The token refresh failing before the append is asked (a 429 / 5xx on the token endpoint) is thrown as it is and proved not_sent: LEDGER-6 / -9.
                "connection.refresh": { cases: ["GOOGLE-LEDGER-6", "GOOGLE-LEDGER-9"] },
            },
        },
    ],
}
