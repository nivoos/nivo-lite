/** A JSON object the ledger keeps. */
export type EffectJson = Readonly<Record<string, unknown>>

/** One row of the effect ledger. */
export interface StoredEffect {
    /** The ledger key of the call. */
    readonly effectKey: string
    /** The effect that ran. */
    readonly effectId: string
    /** The data kind of the subject it touched. */
    readonly subjectEntity: string
    /** The id of the subject. */
    readonly subjectId: string
    /** When the act was taken back (ISO text), or null. */
    readonly undoneAt: string | null
    /** The run of the call, or null. */
    readonly runId: string | null
    /** The step of the run, or null. */
    readonly stepKey: string | null
    /** The arguments of the call, or null. */
    readonly args: EffectJson | null
    /** The facts the act answered, or null. */
    readonly facts: EffectJson | null
    /** When it was kept (ISO text): just after the act, or just before it for an act written as an intent first. */
    readonly createdAt: string
}

/** A row as the ledger writes it once. */
export type EffectInsert = Omit<StoredEffect, "undoneAt" | "createdAt">

/**
 * The effect ledger (public.agent_node_effects), each member scoped to the workspace it names, on its own statement (an act runs outside
 * any transaction). `insert` is an atomic insert-or-nothing on the unique key (`ON CONFLICT DO NOTHING`): false when the key was written
 * first by another try, which the caller then reads with `byKey`.
 */
export interface NodeEffectStore {
    /** The row of a ledger key, or null. */
    byKey(workspaceId: string, effectKey: string): Promise<StoredEffect | null>
    /** The rows of one run step, oldest first, at most `limit`. */
    ofStep(workspaceId: string, runId: string, stepKey: string, limit: number): Promise<ReadonlyArray<StoredEffect>>
    /** Writes the row of a key once: true when this call wrote it. */
    insert(workspaceId: string, effect: EffectInsert): Promise<boolean>
    /**
     * Settles a row still of subject kind `fromKind` (an INTENT written before its act, or a call kept with an UNKNOWN outcome) to what the
     * act answered, or to what a confirmation read proved (QB-P3 rules I-1, I-3; Q-3): the subject and facts replace the open ones, in one
     * conditional statement. True when this call moved the row (a row of any other kind is never touched).
     */
    resettle(workspaceId: string, effectKey: string, fromKind: string, subject: EffectResettle): Promise<boolean>
    /**
     * Deletes the row of a key while it is still of subject kind `kind` (an INTENT whose act answered that nothing happened: a refusal, or
     * a failure typed as such), so a later call of the key really acts (QB-P3 rule I-1). True when this call deleted it.
     */
    release(workspaceId: string, effectKey: string, kind: string): Promise<boolean>
}

/** What an open row (an intent, an unknown outcome) is settled to. */
export type EffectResettle = Pick<StoredEffect, "subjectEntity" | "subjectId" | "facts">

/** The injection token of the effect ledger store. */
export const NODE_EFFECT_STORE: unique symbol = Symbol("NODE_EFFECT_STORE")
