import type { Secret } from "@modules/platform/config"
import type { EntityDefinition } from "@nivo-lite/agent-sdk/entity"
import type { JobDefinition } from "@nivo-lite/agent-sdk/mutation"

/** What the app root tells the entity engine: the declarations it serves and the key that signs its cursors. */
export interface EntityEngineOptions {
    /** Every entity the modules declare; the catalog the engine resolves names against. */
    readonly entities: ReadonlyArray<EntityDefinition>
    /** Every job the modules declare; the module-job processor runs a delivery by name. */
    readonly jobs: ReadonlyArray<JobDefinition>
    /** Names the running build; a job parked under another build is handed back to its queue when this one starts. */
    readonly buildId?: string | undefined
    /** A 32-byte base64 key; cursors are signed with a key derived from it. */
    readonly cursorKey: Secret
}

/**
 * What the app root registers: the engine's options. An app that only reads and writes records (the gateway, the command line) sets
 * `storeOnly`: it gets the scoped transactions, the reads and the writes, and no queue, no ports and no job runner. A job the engine runs
 * that fails is judged and parked by the jobs runner (`platform/jobs`); the engine tells no one.
 */
export interface EntityEngineRegistration extends EntityEngineOptions {
    /** True for an app that only reads and writes records: the engine then registers no queue, no ports and no job runner. */
    readonly storeOnly?: boolean | undefined
}

/** The part of the options the environment supplies. */
export type EntityEngineConfig = Pick<EntityEngineOptions, "cursorKey" | "buildId">
