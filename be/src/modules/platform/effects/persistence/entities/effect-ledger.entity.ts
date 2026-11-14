import { AbstractEntity } from "@modules/platform/database"
import { Column, Entity, PrimaryColumn } from "typeorm"
import type { EffectResult } from "../../effects.port"

/** The state of a ledger row: the act is begun (`intent`), settled (`done`), or lost with its outcome not known (`unknown`). */
export type EffectState = "intent" | "done" | "unknown"

/** What a settled row keeps of the act's answer, wrapped so a kept null differs from nothing kept. */
export interface EffectKept {
    /** The value the call kept of the act's answer. */
    readonly kept: EffectResult
}

@Entity({ schema: "public", name: "effect_ledger" })
/** One act outside the database, by its key `<jobId>:<effect>[:<part>]`: written as an intent before the act, settled after it. */
export class EffectLedgerEntity extends AbstractEntity {
    /** The key of the act; stable across retries and resumes. */
    @PrimaryColumn({ name: "key", type: "text" })
    key!: string

    /** The declared name of the effect (`<capability>.<act>`). */
    @Column({ name: "name", type: "text" })
    name!: string

    /** Where the act stands. */
    @Column({ name: "state", type: "text" })
    state!: EffectState

    /** What the act's answer kept for a later call under the same key; null = nothing kept. */
    @Column({ name: "result", type: "jsonb", nullable: true })
    result!: object | null

    /** When the row was settled as done; null until then. */
    @Column({ name: "settled_at", type: "timestamptz", nullable: true })
    settledAt!: Date | null
}
