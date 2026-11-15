import { isRecord } from "@modules/platform/primitives"
import { DatabaseError, DatabaseErrorCode } from "./database.error"

/**
 * The SQLSTATEs of a statement that failed for the moment, not for what it asked: a serialization failure (40001), a deadlock (40P01),
 * too many connections (53300), a lock that waited past `lock_timeout` (55P03) and a transaction the server ended for sitting idle
 * (25P03, `idle_in_transaction_session_timeout`). The pool bound (`DatabasePoolBound`) is what makes the last two happen.
 */
const TRANSIENT_SQLSTATES: ReadonlySet<string> = new Set(["40001", "40P01", "53300", "55P03", "25P03"])

/** The socket codes of a connection that broke on the way. */
const TRANSIENT_SOCKET_CODES: ReadonlySet<string> = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"])

/**
 * The words node-postgres gives a statement sent on a connection the server already ended (after it ended an idle transaction its next
 * statement fails with a plain `Error`: no `code`, no property, no subclass: the driver gives ONLY these words, in its `Client.query`
 * and in the `end` handler of its connection). They are matched EXACTLY (never a pattern) and only on a failure that is a bare `Error`
 * (a typed one is never read by its words), as the narrowest stable signal there is; a `pg` upgrade that changes them is caught by the
 * pinned spec of this file, not by a silent miss.
 */
const ENDED_CONNECTION_WORDS: ReadonlySet<string> = new Set([
    "Client has encountered a connection error and is not queryable",
    "Connection terminated unexpectedly",
])

/** How far the `cause` chain of a failure is followed. */
const CHAIN_DEPTH = 5

/** The failure, the driver error TypeORM wraps and every cause, the nearest first, bounded so a cycle ends. */
const linksOf = (failure: unknown): ReadonlyArray<Record<string, unknown>> => {
    const links: Array<Record<string, unknown>> = []
    let current = failure
    while (isRecord(current) && links.length < CHAIN_DEPTH) {
        links.push(current)
        if (isRecord(current.driverError)) links.push(current.driverError)
        current = current instanceof Error ? current.cause : undefined
    }
    return links
}

const isBareError = (link: Record<string, unknown>): boolean => link instanceof Error && Object.getPrototypeOf(link) === Error.prototype

const isTransientLink = (link: Record<string, unknown>): boolean => {
    const { code } = link
    if (typeof code === "string") {
        // 08xxx: connection exceptions; 57Pxx: the server shut down, crashed or is not accepting connections.
        if (TRANSIENT_SQLSTATES.has(code) || TRANSIENT_SOCKET_CODES.has(code) || code.startsWith("08") || code.startsWith("57P")) return true
    }
    return isBareError(link) && typeof link.message === "string" && ENDED_CONNECTION_WORDS.has(link.message)
}

/**
 * True when a failed statement or connection failed for the moment (see `TRANSIENT_SQLSTATES`, the socket codes and the ended
 * connection): the same work may pass a moment later. The ONE place the database's transient failures are known: the doors' error
 * mapping, the job runner's and engine's failure classifier and the entity engine's failure policy all read it.
 */
export const isTransientDatabaseFailure = (failure: unknown): boolean => linksOf(failure).some((link) => isTransientLink(link))

/**
 * The typed `DATABASE_UNAVAILABLE` (kind `unavailable`, HTTP 503, tried again by every ladder) for a transient database failure, the
 * failure as its cause; null for anything else (a failure that is already a typed capability error keeps its own code).
 */
export const typedDatabaseFailure = (failure: unknown): DatabaseError | null =>
    failure instanceof DatabaseError || !isTransientDatabaseFailure(failure)
        ? null
        : new DatabaseError({ code: DatabaseErrorCode.Unavailable, cause: failure })
