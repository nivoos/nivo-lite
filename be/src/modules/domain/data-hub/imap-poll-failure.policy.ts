import type { PollFailure } from "@modules/domain/connection-poll"
import { DataSourcesError, DataSourcesErrorCode } from "@modules/integrations/data-sources"

/**
 * How the poll treats what a mailbox read threw, for the live reader and its sandbox twin alike (one reading, never two): a refused login is
 * the credential (only the owner fixes it); a server that does not answer is tried again; anything else ends the walk.
 */
export const imapPollFailureOf = (error: unknown): PollFailure => {
    if (error instanceof DataSourcesError && error.code === DataSourcesErrorCode.Rejected) return { kind: "auth_failed", reason: "credential" }
    if (error instanceof DataSourcesError && error.code === DataSourcesErrorCode.Unavailable) return { kind: "transient" }
    return { kind: "fatal" }
}
