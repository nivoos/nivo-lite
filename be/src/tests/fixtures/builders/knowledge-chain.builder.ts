import type { EntityManager } from "typeorm"
import { mock } from "@starci/jest-preset"
import type { Effects, EffectResult } from "@modules/platform/effects"
import { EFFECTS } from "@modules/platform/effects/effects.decorators"
import { JOB_PROGRESS, type ClaimedJob, type JobProgress } from "@modules/platform/jobs"

/** The id of the job row every spec of the knowledge chain runs under. */
export const CHAIN_JOB_ID = "job-1"

/** A claimed job of the chain: the row the runner would hand the processor (a resume is `resumeCount` 1 and above). */
export const claimedJob = (payload: object = {}, extra: Partial<ClaimedJob> = {}): ClaimedJob => ({
    jobId: CHAIN_JOB_ID,
    kind: "knowledge.job",
    fencingToken: 1,
    currentStep: null,
    payload,
    ...extra,
})

/** One effect the ledger kept: its key, whether its act was made, and the kept result once settled. */
export interface LedgerRow {
    /** The key `<jobId>:<effect>[:<part>]`. */
    readonly key: string
    /** How many times the act was made under the key. */
    acts: number
    /** The result the key was settled with (by `settleIn` or `keep`), or undefined while it is an intent. */
    result?: EffectResult | undefined
}

/**
 * The effects port as an in-memory ledger with the semantics of the real piece for a `repeatable` effect: the act is always made (a
 * lost outcome is acted again under the same key), a key settled by `settleIn` or by a kept result stays settled, and a spec reads
 * what was keyed. `failNext(key)` makes the next act under a key throw, to kill a run between two steps.
 */
export const effectsLedger = () => {
    const rows = new Map<string, LedgerRow>()
    const failures = new Map<string, Error>()
    const once = async (key: string, _effect: unknown, call: { readonly act: () => Promise<unknown> }): Promise<void> => {
        const row = rows.get(key) ?? { key, acts: 0 }
        rows.set(key, row)
        const failure = failures.get(key)
        if (failure !== undefined) {
            failures.delete(key)
            throw failure
        }
        row.acts += 1
        await call.act()
    }
    const settleIn = (_tx: EntityManager, key: string, result: EffectResult): Promise<void> => {
        const row = rows.get(key) ?? { key, acts: 0 }
        rows.set(key, row)
        row.result = result
        return Promise.resolve()
    }
    const effects = { once, settleIn } as Effects
    return {
        effects,
        rows,
        /** The keys whose act was made, in the order they were first keyed. */
        keys: (): ReadonlyArray<string> => [...rows.keys()],
        /** The keys settled with a result. */
        settled: (): ReadonlyArray<string> => [...rows.values()].filter((row) => row.result !== undefined).map((row) => row.key),
        /** The next act under this key throws this error (the process "dies" there). */
        failNext: (key: string, error: Error): void => {
            failures.set(key, error)
        },
    }
}

/** The providers a service of the chain needs for the effects port and the progress port, with the progress port as a mock a spec reads. */
export const chainProviders = (ledger: ReturnType<typeof effectsLedger> = effectsLedger()) => {
    const progress = mock<JobProgress>()
    return {
        ledger,
        progress,
        providers: [
            { provide: EFFECTS, useValue: ledger.effects },
            { provide: JOB_PROGRESS, useValue: progress },
        ],
    }
}
