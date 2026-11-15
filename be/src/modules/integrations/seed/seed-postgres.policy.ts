import type { StoreAdapter } from "@starci/seed"
import type { PostgresRunner } from "@starci/seed/postgres"
import type { SeedPostgresLibrary } from "./seed.port"

/** The store id of the whole relational database of the deployment. */
export const DATABASE_ALL_STORE_ID = "database-all"

/**
 * The schemas the whole-database copy holds: `public` (every table of the product) and `auth` (the accounts: `auth.users`,
 * `auth.identities`, `auth.sessions`, which every `public` row of a person points at). `extensions` holds only the extensions; `storage`
 * is created empty by `db/bootstrap.sql` (the lite edition runs no storage api: files live in the S3 store) and `be_access` holds
 * functions, no data.
 */
export const BACKUP_SCHEMAS: ReadonlyArray<string> = ["public", "auth"]

/** One table the whole-database copy leaves out and why: an entry names its set as `<schema>.<table>`. */
export interface BackupExclusion {
    /** The set name, `<schema>.<table>`. */
    readonly table: string
    /** Why it is not held: a fixed sentence, written from what the table is for (the migrations and `.starciwork/concepts`). */
    readonly reason: string
}

/**
 * What the whole-database copy does NOT hold, each with its reason. The test is one question: can the environment rebuild this table by
 * itself after a restore, or is it only a cache of the moment? Everything else is held, so a table a future migration adds is held until
 * someone decides, in this list, that it is rebuildable (the safe default of a backup). Kept in the order of the reasons:
 * delivery leases and counters first, replay buffers next, derived cursors last.
 */
export const BACKUP_EXCLUSIONS: ReadonlyArray<BackupExclusion> = [
    {
        table: "public.job_slots",
        reason: "per-queue concurrency leases (`lease_until`) that expire by themselves; a restored lease would only hold a slot for a worker that no longer exists",
    },
    {
        table: "public.job_ticks",
        reason: "the last UTC minute each scheduler tick fired; the first tick after a restore claims its minute again, so nothing is lost by leaving it out",
    },
    {
        table: "public.agent_work_leases",
        reason: "the 90 second lease of the one runner of an agent thread; the heartbeat takes a new one, a restored lease would block the runner until it expires",
    },
    {
        table: "public.http_security",
        reason: "fixed rate-limit windows of the api and the gateway; a cache of the last minute",
    },
    {
        table: "public.api_rate_limits",
        reason: "fixed rate-limit windows of the api keys; a cache of the last minute",
    },
    {
        table: "public.identity_attempts",
        reason: "sign-in attempt counters inside a short window; restoring them would lock people out for no reason",
    },
    {
        table: "public.realtime_events",
        reason: "the bounded replay buffer of the live stream (the Redis hub keeps it elsewhere); a reconnecting client falls back to the current state of the rows",
    },
    {
        table: "public.vector_sync_state",
        reason: "the cursor of the vector reconcile job over Qdrant, a derived index; the job starts again from the rows, which it maps one to one to the points",
    },
]

/** The whole-database store of the deployment: `database-all` over the runner, holding `BACKUP_SCHEMAS` minus `BACKUP_EXCLUSIONS`. */
export const databaseAllOf = (library: SeedPostgresLibrary, run: PostgresRunner): StoreAdapter =>
    library.postgresStore({
        id: DATABASE_ALL_STORE_ID,
        run,
        schemas: [...BACKUP_SCHEMAS],
        exclude: BACKUP_EXCLUSIONS.map((entry) => ({ table: entry.table, reason: entry.reason })),
    })
