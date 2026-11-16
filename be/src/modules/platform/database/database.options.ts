import type { Secret } from "@modules/platform/config"

/** What the primary connection parser reads from the environment. */
export interface DatabaseConnectionConfig {
    /** The logical connection name declared in `hfs.json`. */
    readonly name: string
    /** The PostgreSQL provider; schema changes remain under `db/migrations`. */
    readonly provider: "postgres"
    /** The dedicated least-privilege application role's connection URL. */
    readonly url: Secret
}

/**
 * THE BOUND of one app connection's pool and sessions (D3-W1-6): the app can never stand still for ever. A request waits a bounded time
 * for a pooled connection, a statement a bounded time for a lock, and the database ends a transaction left idle; each of these fails
 * typed and transient instead. The values hold the longest legitimate lock-holding work of the app with room (a delivery batch, a
 * knowledge move: about a second); a migration (its own process and owner URL) and the whole-database backup (its own owner connection)
 * do not open this pool.
 */
export interface DatabasePoolBound {
    /** How many connections the pool holds (`PRIMARY_DB_POOL_MAX`, default 20). */
    readonly max: number
    /** How long a request waits for a pooled connection before it fails `DATABASE_UNAVAILABLE` (`PRIMARY_DB_ACQUIRE_TIMEOUT`, ms, default 10 s). */
    readonly acquireTimeoutMs: number
    /** The session's `lock_timeout`: a statement waits this long for a lock, then fails 55P03 (`PRIMARY_DB_LOCK_TIMEOUT`, ms, default 15 s). */
    readonly lockTimeoutMs: number
    /** The session's `idle_in_transaction_session_timeout`: the database ends a transaction idle this long (`PRIMARY_DB_IDLE_TRANSACTION_TIMEOUT`, ms, default 60 s). */
    readonly idleTransactionTimeoutMs: number
}

/** Runtime connection options add only the isolated PostgreSQL schema; entities come from the apps, migrations stay under `db/migrations`. */
export interface DatabaseConnectionOptions extends DatabaseConnectionConfig {
    /** The schema named by the `hfs.json` isolation contract. */
    readonly schema?: string
    /** The pool and session bound; absent: the defaults of `primary.config.ts`. */
    readonly bound?: DatabasePoolBound
}

/** Options of the database capability. */
export interface DatabaseOptions {
    /** The integration-owned type parsers created separately for each app connection. */
    readonly typeParsers: () => unknown
    /**
     * Every entity class the app maps, normally `PRIMARY_ENTITIES` from `platform/database/entities`.
     * It is an option rather than an import because the capability barrels that list entities import this capability.
     */
    readonly entities: ReadonlyArray<new () => object>
    /** The connections this app opens; one per physical database. */
    readonly connections: ReadonlyArray<DatabaseConnectionOptions>
}
