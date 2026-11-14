import type { EntityManager } from "typeorm"
import type { JobEffectDeclaration } from "@modules/platform/jobs"

/** A value an effect may keep as its result: JSON only, small (an id, a count, a status); never a large payload such as vectors. */
export type EffectResult = string | number | boolean | null | { readonly [key: string]: EffectResult } | ReadonlyArray<EffectResult>

/** What the read that confirms a lost act answers when the call keeps the act's answer: that answer when it happened, null when it did not. */
type EffectConfirmed<T> = T | null

/** A call that keeps nothing of the act's answer on the ledger row: an act with no answer a later call needs. */
export interface EffectCallPlain {
    /** The act outside the database (a provider request, a mail, a paid model call, a vector write); its answer is not kept and `once` answers nothing. */
    readonly act: () => Promise<unknown>
    /** For an effect declared `settle: "confirm"`: the read that tells whether a lost act happened (true) or not (false). */
    readonly confirm?: () => Promise<boolean>
    /** Nothing of the answer is kept. */
    readonly keep?: undefined
    /** Nothing was kept, so nothing is rebuilt. */
    readonly from?: undefined
}

/** A call that keeps the act's answer, so a later call under the same key answers it without acting. */
export interface EffectCallKept<T> {
    /** The act outside the database (a provider request, a mail, a paid model call, a vector write). */
    readonly act: () => Promise<T>
    /** For an effect declared `settle: "confirm"`: the read that tells whether a lost act happened; its answer, or null when it did not. */
    readonly confirm?: () => Promise<EffectConfirmed<T>>
    /** What of the act's answer is kept on the ledger row. */
    readonly keep: (answer: T) => EffectResult
    /** Rebuilds the answer from a kept result (the inverse of `keep`). */
    readonly from: (kept: EffectResult) => T
    /** True when the answer says the act did nothing (a refusal): its intent is released and the answer is answered, never kept. */
    readonly nothingDone?: (answer: T) => boolean
    /**
     * True when the kept value is a SECRET (a link token, a password link, a token pair): `keep`'s value is sealed before the ledger row
     * is written and opened when it is read, with the one sealing key the capability is registered with, so no secret rests in plain
     * text. `from` still receives the opened value. Without the key the call fails `EFFECTS_SEALING_MISSING`.
     */
    readonly secret?: true
}

/**
 * The ONE door of an act outside NIVO's database (J-5). `once(key, effect, call)`: the ledger row is committed as an INTENT before the
 * act, the act runs, its kept result settles the row after. A key already settled with a kept result answers it and does not act. A key
 * found as an intent with no result (the process died after the act may have left) is OUTCOME UNKNOWN and is settled as the effect
 * declares: `repeatable` acts again under the same key; `confirm` asks `call.confirm` (happened = settled with its answer; not happened
 * = outcome unknown); `person` = outcome unknown at once. Outcome unknown throws `EffectsError` code `EFFECTS_OUTCOME_UNKNOWN` (class
 * `input`: the job runner dead-letters it; never a blind second act). An act that throws RELEASES its intent (the act says it did not
 * happen) unless the throw carries the typed param `outcomeUnknown: 1`, which keeps it unknown. The key of a job's effect is
 * `<jobId>:<effect name>[:<part>]`: stable across retries and resumes, never the fencing token.
 */
export interface Effects {
    /** Makes an act whose answer is not kept at most once per key, as described above. */
    once(key: string, effect: JobEffectDeclaration, call: EffectCallPlain): Promise<void>
    /** Makes an act whose answer is kept at most once per key, as described above. */
    once<T>(key: string, effect: JobEffectDeclaration, call: EffectCallKept<T>): Promise<T>
    /** Settles a key inside the caller's transaction (the domain write that keeps the act's answer, such as stored passages), so the answer and the settle commit together. */
    settleIn(tx: EntityManager, key: string, result: EffectResult): Promise<void>
}

/** What a done ledger row kept of its act's answer. */
export interface EffectLedgerKept {
    /** The kept value (a kept null differs from nothing kept). */
    readonly kept: EffectResult
}

/** One row of an effect ledger as the rules read it. */
export interface EffectLedgerRow {
    /** The effect that wrote the key. */
    readonly name: string
    /** `intent`: written before its act, no result yet; `done`: settled; `unknown`: nobody knows whether the act happened. */
    readonly state: "intent" | "done" | "unknown"
    /** What a done row kept of the act's answer; undefined when it kept nothing (and for an open row). */
    readonly kept: EffectLedgerKept | undefined
}

/**
 * Where the rows of one family of effects live, and how that family types its failures: the jobs' `public.effect_ledger`, or a
 * capability's own table (the graph nodes' `agent_node_effects`, keyed `<run>:<step>:<digest>`). It only reads and writes rows; the
 * rules (intent before act, settle, the settling of a lost act) are `EffectLedgerRules`', never a ledger's.
 */
export interface EffectLedger {
    /** The row of a key, or null. */
    find(key: string): Promise<EffectLedgerRow | null>
    /**
     * Writes the INTENT of a key before its act, on its own committed statement: false when another try wrote the key first. A ledger
     * of acts wholly inside the database may write nothing here (the act's own write is kept after it) and answer true.
     */
    open(key: string, name: string): Promise<boolean>
    /** Makes a found row (a lost act, a repeatable settled one) an intent again before its act is made again. */
    reopen(key: string): Promise<void>
    /** Settles the open row of a key as done with what it keeps: false when there was no open row to settle (another try holds the key). */
    settle(key: string, kept: EffectLedgerKept | undefined): Promise<boolean>
    /** Keeps the row of a key as an unknown outcome: after the act threw `failure`, or (undefined) a lost act found by a later call. */
    markUnknown(key: string, failure: unknown): Promise<void>
    /** Deletes the intent of a key whose act said nothing happened, so a later call really acts. */
    release(key: string): Promise<void>
    /** True when the family reads a failure of the act as an outcome nobody knows (the act may have left). */
    isOutcomeUnknown(failure: unknown): boolean
    /** The family's typed failure for a key: an outcome unknown of the row found, or (null) a key lost to a try that holds no row. */
    failureOf(key: string, effect: JobEffectDeclaration, found: EffectLedgerRow | null): Error
}

/** The key of the phantom member `OutsideReads` carries: never set at run time, read by the lint only. */
declare const OUTSIDE_READS: unique symbol

/**
 * What a port declares as its outside READS: members that only read the outside world (a page of an index, the rows a source holds,
 * whether a client is configured) and change nothing there, so a job calls them with no intent row. A port interface extends it, naming
 * its read members: `interface SearchIndex extends OutsideReads<"page" | "count">`; a client class with no contract merges an interface of
 * its own name that extends it (`export interface AiClient extends OutsideReads<"available"> {}` above the class). A member it does not
 * name is an ACT and goes through `Effects.once`; a member that creates or changes anything outside, even safely repeatable, is an act.
 */
export interface OutsideReads<Member extends string> {
    /** Phantom: the names of the read members; never set. */
    readonly [OUTSIDE_READS]?: Member
}
