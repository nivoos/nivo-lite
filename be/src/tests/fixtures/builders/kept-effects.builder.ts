import { EFFECTS } from "@modules/platform/effects/effects.decorators"
import type { EffectResult, Effects } from "@modules/platform/effects"
import type { JobEffectDeclaration } from "@modules/platform/jobs"

/** One key of the in-memory ledger: how often its act was made, and the result a settle kept (undefined while it is an intent or kept nothing). */
export interface KeptEffectRow {
    /** The key `<jobId>:<effect>[:<part>]`. */
    readonly key: string
    /** How many times the act was made under the key. */
    acts: number
    /** True once the row is settled as done. */
    done: boolean
    /** The result the call kept, when it keeps one. */
    kept?: EffectResult | undefined
}

/** A call as the port takes it: the act and, for a call that keeps its answer, `keep` and `from`. */
interface LedgerCall {
    readonly act: () => Promise<unknown>
    readonly keep?: ((answer: never) => EffectResult) | undefined
    readonly from?: ((kept: EffectResult) => unknown) | undefined
    readonly secret?: true | undefined
}

/** The stand-in for the real sealing of a call declared `secret`: a text, never the value, is what the ledger row keeps. */
const SEALED_PREFIX = "sealed:"

/** What the row keeps of a value: the value, or for a secret call its sealed text. */
const sealedOf = (call: LedgerCall, value: EffectResult): EffectResult => (call.secret === true ? `${SEALED_PREFIX}${JSON.stringify(value)}` : value)

/** The value a row kept, opened when the call is a secret one. */
const openedOf = (call: LedgerCall, kept: EffectResult): EffectResult =>
    call.secret === true && typeof kept === "string" ? (JSON.parse(kept.slice(SEALED_PREFIX.length)) as EffectResult) : kept

/**
 * The effects port as an in-memory ledger with the semantics of the real piece for `repeatable` effects: a key settled with a kept
 * result answers that result and does not act; a plain key that is done and a key that is only an intent are acted again (a lost outcome
 * of a repeatable effect); an act that throws releases its intent. A spec reads `rows`, makes the next act under a key throw
 * (`failNext`: the process dies before the act) or lose its outcome (`loseNext`: the act is made, then the process dies before the
 * settle, so the row stays an intent).
 */
export const keptEffectsLedger = () => {
    const rows = new Map<string, KeptEffectRow>()
    const failures = new Map<string, Error>()
    const losses = new Map<string, Error>()
    const once = async (key: string, _effect: JobEffectDeclaration, call: LedgerCall): Promise<unknown> => {
        const row = rows.get(key) ?? { key, acts: 0, done: false }
        rows.set(key, row)
        if (row.done && row.kept !== undefined && call.from !== undefined) return call.from(openedOf(call, row.kept))
        const failure = failures.get(key)
        if (failure !== undefined) {
            failures.delete(key)
            throw failure
        }
        row.done = false
        row.acts += 1
        let answer: unknown
        try {
            answer = await call.act()
        } catch (error) {
            rows.delete(key)
            throw error
        }
        const loss = losses.get(key)
        if (loss !== undefined) {
            losses.delete(key)
            throw loss
        }
        row.done = true
        row.kept = call.keep === undefined ? undefined : sealedOf(call, call.keep(answer as never))
        return answer
    }
    const effects = { once, settleIn: () => Promise.resolve() } as unknown as Effects
    return {
        effects,
        rows,
        providers: [{ provide: EFFECTS, useValue: effects }],
        /** The keys that were acted at least once, in the order they were first keyed. */
        keys: (): ReadonlyArray<string> => [...rows.keys()],
        /** The next act under this key throws this error before it is made. */
        failNext: (key: string, error: Error): void => {
            failures.set(key, error)
        },
        /** The next act under this key is made, then the process "dies": the throw leaves the row an intent. */
        loseNext: (key: string, error: Error): void => {
            losses.set(key, error)
        },
    }
}
