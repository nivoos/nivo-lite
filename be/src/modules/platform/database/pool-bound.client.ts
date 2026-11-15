import type { DataSource } from "typeorm"
import { DatabaseError, DatabaseErrorCode } from "./errors/database.error"
import type { DatabasePoolBound } from "./database.options"

/** The node-postgres pool options and session settings of a bound: every connection the pool opens starts its session with them. */
export const poolOptionsOf = (bound: DatabasePoolBound): Readonly<Record<string, number>> => ({
    max: bound.max,
    // pg-pool: how long `connect` waits for a free or a new connection before it fails (it then drops the waiter from its queue).
    connectionTimeoutMillis: bound.acquireTimeoutMs,
    // Session startup parameters (node-postgres sends them with the connection): no SET statement, no superuser, no migration.
    lock_timeout: bound.lockTimeoutMs,
    idle_in_transaction_session_timeout: bound.idleTransactionTimeoutMs,
})

/** The callback node-postgres hands a connection (or the failure to get one) to. */
type AcquireCallback = (failure: unknown, client: unknown, release: unknown) => void

/** The one method of a pg-pool this bound wraps (TypeORM's driver acquires every connection through it, callback form). */
interface AcquiringPool {
    connect(callback?: AcquireCallback): unknown
}

const isAcquiringPool = (value: unknown): value is AcquiringPool =>
    typeof value === "object" && value !== null && typeof Reflect.get(value, "connect") === "function"

/** The typed failure of an acquire, the pool's own error as its cause. */
const unavailable = (cause: unknown): DatabaseError => new DatabaseError({ code: DatabaseErrorCode.Unavailable, cause })

/**
 * Types the failure to ACQUIRE a pooled connection (the acquire bound passed, the database refused or away): it surfaces as
 * `DATABASE_UNAVAILABLE` (kind `unavailable`, transient for every ladder) with the pool's own error as its cause, never as an untyped
 * error a door masks. Known by where it comes from (the pool's connect callback), never by its words.
 */
export const typeAcquireFailures = (source: DataSource): void => {
    const pool: unknown = Reflect.get(source.driver, "master")
    if (!isAcquiringPool(pool)) return
    const connect = pool.connect.bind(pool)
    pool.connect = (callback?: AcquireCallback): unknown => {
        if (callback === undefined) {
            return Promise.resolve(connect()).catch((error: unknown) => {
                throw unavailable(error)
            })
        }
        return connect((failure, client, release) => callback(failure === undefined || failure === null ? failure : unavailable(failure), client, release))
    }
}
