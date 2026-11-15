import type { SandboxCoverage } from "@modules/domain/provider-sandbox/sandbox-situations"

/*
 * GOOGLE DRIVE'S SANDBOX COVERAGE (SBX standard 2026-11-15): the workspace's Drive grant is only READ (`drive-live-reach.service.ts`): `grant`
 * (where the access stands), `list` (the files of a folder), `read` (the text of one file), and `connection` (the grant's token). A Drive
 * folder or file is read-only here: no act, no inbound. Words: the documents integration's `DocumentsErrorCode` (documents.error.ts), the Drive
 * client (drive-api.client.ts, drive-folder.client.ts) and the http wrapper (documents-http.client.ts: a cut or a timeout is Unavailable, status 0).
 */
export const GOOGLE_DRIVE_SANDBOX_COVERAGE: SandboxCoverage = {
    provider: "google_drive",
    roles: [
        {
            role: "read",
            operation: "grant",
            covers: {
                // GOOGLE_DRIVE-2: the workspace never gave Drive access (`state()` answers none).
                "read.not_found": { cases: ["GOOGLE_DRIVE-2"] },
                "read.page": { na: "grant answers one state (none, connected or lost): nothing is listed or paged" },
                "read.transient": { na: "grant reads the stored grant connection in NIVO's own database (DriveGrantService.state) and calls no outside system: nothing outside can say not now" },
                "read.timeout": { na: "grant reads the stored grant connection in NIVO's own database (DriveGrantService.state) and calls no outside system: nothing outside can fail to answer" },
            },
        },
        {
            role: "read",
            operation: "list",
            covers: {
                // Drive answers 403 / 404 for a folder the connected account cannot open: ONE typed error (DOCUMENTS_DRIVE_NO_ACCESS) for both.
                "read.not_found": { cases: ["GOOGLE_DRIVE-8"] },
                "read.page": { cases: ["GOOGLE_DRIVE-6"] },
            },
        },
        {
            role: "read",
            operation: "read",
            covers: {
                // The Drive 404 and 403 of a file the account cannot open are one typed error, DOCUMENTS_DRIVE_NO_ACCESS; an id the sandbox Drive holds none under answers it too.
                "read.not_found": { cases: ["GOOGLE_DRIVE-14"] },
                "read.page": { na: "a file read answers the whole text of one file (cut at DOCUMENT_MAX_TEXT by the reader) or is refused too large (GOOGLE_DRIVE-12): there is no page to ask for" },
            },
        },
        {
            role: "connection",
            covers: {
                // DOCUMENTS_TOKEN_REJECTED (401): the stored token needs a refresh.
                "connection.credential_refused": { cases: ["GOOGLE_DRIVE-7"] },
                // The grant is lost (the access revoked on the Google side): on the grant state and on a listing.
                "connection.revoked": { cases: ["GOOGLE_DRIVE-3", "GOOGLE_DRIVE-10"] },
                // drive-api.client.ts refreshAccessToken: invalid_grant from Google's token endpoint is DOCUMENTS_GOOGLE_GRANT_REVOKED.
                "connection.refresh": { cases: ["GOOGLE_DRIVE-18"] },
            },
        },
    ],
}
