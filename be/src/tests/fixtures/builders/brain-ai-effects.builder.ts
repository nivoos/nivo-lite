import { Test } from "@nestjs/testing"
import type { EntityManager } from "typeorm"
import { mock } from "@starci/jest-preset"
import type { Effects, EffectResult } from "@modules/platform/effects"
import { EFFECTS } from "@modules/platform/effects/effects.decorators"
import {
    JOB_CLAIMS,
    JOB_PROGRESS,
    JobDeadLettersService,
    JobRenewalService,
    JobRunnerService,
    JobStateEventsService,
    type ClaimedJob,
    type JobClaims,
    type JobProgress,
} from "@modules/platform/jobs"
import { JOBS_OPTIONS } from "@modules/platform/jobs/jobs.decorators"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_WORKER_REGISTRY } from "@modules/platform/queue"
import type { QueueDelivery, QueueWorkerRegistry } from "@modules/platform/queue"

/** The id of the job row every spec of the brain / AI chains runs under. */
export const AI_JOB_ID = "job-1"

/** A claimed job: the row the runner would hand the processor (a resume is `resumeCount` 1 and above). */
export const claimedAiJob = (payload: object = {}, extra: Partial<ClaimedJob> = {}): ClaimedJob => ({
    jobId: AI_JOB_ID,
    kind: "ai.job",
    fencingToken: 1,
    currentStep: null,
    payload,
    ...extra,
})

/** One key of the ledger: how many times its act was made, and the result it was settled with (undefined while it keeps none). */
export interface AiLedgerRow {
    /** The key `<jobId>:<effect>[:<part>]`. */
    readonly key: string
    /** How many times the act was made under the key. */
    acts: number
    /** The kept result of the key. */
    result?: EffectResult | undefined
}

/** A call as the port takes it: the act, and for a call that keeps its answer `keep` and `from`. */
interface AiLedgerCall {
    readonly act: () => Promise<unknown>
    readonly keep?: ((answer: never) => EffectResult) | undefined
    readonly from?: ((kept: EffectResult) => unknown) | undefined
}

/**
 * The effects port as an in-memory ledger with the semantics of the real piece for a `repeatable` effect: a key settled with a kept
 * result answers it and does not act; a call that keeps nothing acts every time (a lost outcome is made again); an act that throws
 * releases its intent (nothing is kept). `failNext(key)` makes the next act under a key throw before it acts: the worker is gone.
 */
export const aiEffectsLedger = () => {
    const rows = new Map<string, AiLedgerRow>()
    const failures = new Map<string, Error>()
    const once = async (key: string, _effect: unknown, call: AiLedgerCall): Promise<unknown> => {
        const row = rows.get(key) ?? { key, acts: 0 }
        rows.set(key, row)
        if (row.result !== undefined && call.from !== undefined) return call.from(row.result)
        const failure = failures.get(key)
        if (failure !== undefined) {
            failures.delete(key)
            throw failure
        }
        row.acts += 1
        const answer = await call.act()
        if (call.keep !== undefined) row.result = call.keep(answer as never)
        return answer
    }
    const settleIn = (_tx: EntityManager, key: string, result: EffectResult): Promise<void> => {
        const row = rows.get(key) ?? { key, acts: 0 }
        rows.set(key, row)
        row.result = result
        return Promise.resolve()
    }
    const effects = { once, settleIn } as unknown as Effects
    return {
        effects,
        rows,
        /** The keys that were keyed, in the order they were first seen. */
        keys: (): ReadonlyArray<string> => [...rows.keys()],
        /** The keys settled with a kept result. */
        settled: (): ReadonlyArray<string> => [...rows.values()].filter((row) => row.result !== undefined).map((row) => row.key),
        /** The next act under this key throws this error (the process "dies" there). */
        failNext: (key: string, error: Error): void => {
            failures.set(key, error)
        },
    }
}

/** The providers a service needs for the effects port and the progress port (a mock a spec reads). */
export const aiChainProviders = (ledger: ReturnType<typeof aiEffectsLedger> = aiEffectsLedger()) => {
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

/** A delivery of the broker to the runner: `attempt` is the start the queue counts (1 = the first). */
export const aiDeliveryOf = (queue: string, job: string, payload: object, attempt: number): QueueDelivery => ({
    id: "d-1",
    queue,
    job,
    payload,
    attempt,
    signal: new AbortController().signal,
})

/** What the network says when nothing answers: the classifier calls it transient. */
export const aiOutage = (): Error => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" })

/** The process "dies" here: the error an act throws when its worker is gone before the act's outcome is known. */
export const aiKilled = (): Error => Object.assign(new Error("worker killed"), { code: "ECONNRESET" })

/**
 * The runner of fenced jobs over a claims double: the real classifier, the real ladders, the real dead-letter path. `resumeCount` 1 and
 * above is a job a person handed back after its dead letter; `claimed(payload)` makes the next claim answer a job with that payload.
 */
export const aiRunnerHarness = async (resumeCount = 0) => {
    const claims = mock<JobClaims>()
    const job = (payload: object): ClaimedJob => ({
        jobId: AI_JOB_ID,
        kind: "ai.job",
        fencingToken: 1,
        currentStep: null,
        payload,
        ...(resumeCount > 0 ? { resumeCount } : {}),
    })
    claims.park.mockResolvedValue(true)
    claims.fail.mockResolvedValue(undefined)
    claims.release.mockResolvedValue(undefined)
    claims.complete.mockResolvedValue(undefined)
    claims.advance.mockResolvedValue(undefined)
    claims.retryAfterSeconds.mockResolvedValue(null)
    const deadLetters = mock<JobDeadLettersService>()
    deadLetters.raise.mockResolvedValue(undefined)
    const states = mock<JobStateEventsService>()
    states.changed.mockResolvedValue(undefined)
    const renewals = mock<JobRenewalService>()
    renewals.keep.mockReturnValue({ stop: jest.fn() })
    const moduleRef = await Test.createTestingModule({
        providers: [
            JobRunnerService,
            { provide: JOBS_OPTIONS, useValue: { connection: "primary", workerId: "w-1", leaseMs: 60_000, scheduler: { enabled: false }, buildId: "b1" } },
            { provide: JOB_CLAIMS, useValue: claims },
            { provide: QUEUE_WORKER_REGISTRY, useValue: mock<QueueWorkerRegistry>() },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: JobRenewalService, useValue: renewals },
            { provide: JobDeadLettersService, useValue: deadLetters },
            { provide: JobStateEventsService, useValue: states },
        ],
    }).compile()
    return {
        runner: moduleRef.get(JobRunnerService),
        claims,
        deadLetters,
        claimed: (payload: object): void => {
            claims.claim.mockResolvedValue(job(payload))
        },
    }
}
