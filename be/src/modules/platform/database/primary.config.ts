import type { EnvSource } from "@modules/platform/config"
import type { DatabaseConnectionOptions, DatabasePoolBound } from "./database.options"
import { PRIMARY_CONNECTION } from "./primary.connection"

/** The bound every app connection takes when its environment names none (see `DatabasePoolBound`). */
export const DEFAULT_POOL_BOUND: DatabasePoolBound = {
    max: 20,
    acquireTimeoutMs: 10_000,
    lockTimeoutMs: 15_000,
    idleTransactionTimeoutMs: 60_000,
}

/** Reads the pool and session bound of the primary connection; each key is an optional tunable with its default. */
export const parsePoolBound = (env: EnvSource): DatabasePoolBound => ({
    max: env.int("PRIMARY_DB_POOL_MAX", DEFAULT_POOL_BOUND.max),
    acquireTimeoutMs: env.duration("PRIMARY_DB_ACQUIRE_TIMEOUT", DEFAULT_POOL_BOUND.acquireTimeoutMs),
    lockTimeoutMs: env.duration("PRIMARY_DB_LOCK_TIMEOUT", DEFAULT_POOL_BOUND.lockTimeoutMs),
    idleTransactionTimeoutMs: env.duration("PRIMARY_DB_IDLE_TRANSACTION_TIMEOUT", DEFAULT_POOL_BOUND.idleTransactionTimeoutMs),
})

/** Reads the least-privilege PostgreSQL connection with no default, and its pool bound. */
export const parsePrimaryDatabaseConfig = (env: EnvSource): DatabaseConnectionOptions => ({
    name: PRIMARY_CONNECTION,
    provider: "postgres",
    url: env.secret("PRIMARY_DB_URL"),
    schema: env.string("PRIMARY_DB_SCHEMA"),
    bound: parsePoolBound(env),
})
