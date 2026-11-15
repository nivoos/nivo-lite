import { DataSourcesError, DataSourcesErrorCode } from "@modules/integrations/data-sources"
// NEED (integrations owner): export `describeImapError` (and the client's `toError`, which this file repeats in three lines) from the data-sources index; until then it is read from its file.
import { describeImapError } from "@modules/integrations/data-sources/imap-error.policy"

/**
 * What the live IMAP client throws for a server answer, built by the live path itself: the library-shaped failure goes through
 * `describeImapError` and the same Rejected / Unavailable split `ImapClient` (`toError`) makes, so a case never invents a word or a code.
 */
const liveFailureOf = (raw: { readonly authenticationFailed?: true; readonly code?: string; readonly responseText?: string; readonly message: string }): DataSourcesError => {
    const failure = describeImapError(raw)
    return new DataSourcesError({
        code: failure.rejected ? DataSourcesErrorCode.Rejected : DataSourcesErrorCode.Unavailable,
        params: { detail: failure.detail },
    })
}

/** The server refused the login (imapflow `authenticationFailed`, response `AUTHENTICATIONFAILED`): the live `DataSourcesError` Rejected. */
export const imapLoginRefused = (): DataSourcesError =>
    liveFailureOf({ authenticationFailed: true, responseText: "AUTHENTICATIONFAILED Invalid credentials (Failure)", message: "Command failed" })

/** The server refused the connection (`ECONNREFUSED`): the live `DataSourcesError` Unavailable (the poll is tried again). */
export const imapUnreachable = (): DataSourcesError => liveFailureOf({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 203.0.113.25:993" })
