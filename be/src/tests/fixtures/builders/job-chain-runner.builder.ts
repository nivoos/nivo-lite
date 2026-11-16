import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import {
    JOB_CLAIMS,
    JobDeadLettersService,
    JobRenewalService,
    JobRunnerService,
    JobStateEventsService,
    type ClaimedJob,
    type JobClaims,
    type JobEffectDeclaration,
} from "@modules/platform/jobs"
import { JOBS_OPTIONS } from "@modules/platform/jobs/jobs.decorators"
import type { EffectCallKept, EffectResult } from "@modules/platform/effects"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_WORKER_REGISTRY } from "@modules/platform/queue"
import type { QueueDelivery, QueueWorkerRegistry } from "@modules/platform/queue"

/** The id of the job row every chain spec of a delivery runs under. */
export const CHAIN_RUN_JOB_ID = "job-1"

/** One delivery of a job to its processor on its `attempt`-th start (the id is the outbox row, stable across the retries). */
export const deliveryOf = (queue: string, job: string, payload: object, attempt: number): QueueDelivery => ({
    id: "d-1",
    queue,
    job,
    payload,
    attempt,
    signal: new AbortController().signal,
})

/** What the network says when nothing answers: the classifier calls it transient. */
export const networkRefused = (): Error => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" })

/**
 * The runner of fenced jobs over a claims double: the real classifier, the real ladders and the real dead-letter path, with the claim a
 * spec hands out (`claimed(payload, resumeCount)`), the parks it wrote and the alerts it raised readable.
 */
export const buildChainRunner = async () => {
    const claims = mock<JobClaims>()
    claims.park.mockResolvedValue(true)
    claims.fail.mockResolvedValue(undefined)
    claims.release.mockResolvedValue(undefined)
    claims.complete.mockResolvedValue(undefined)
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
    const claimed = (payload: object, resumeCount = 0): void => {
        const job: ClaimedJob = {
            jobId: CHAIN_RUN_JOB_ID,
            kind: "x",
            fencingToken: 1,
            currentStep: null,
            payload,
            ...(resumeCount > 0 ? { resumeCount } : {}),
        }
        claims.claim.mockResolvedValue(job)
    }
    return { runner: moduleRef.get(JobRunnerService), claims, deadLetters, claimed }
}

/** One effect of the kept-answer ledger: how many times its act was made and what it kept. */
export interface KeptEffectRow {
    /** The times the act was made under the key. */
    acts: number
    /** The kept result, once the act's answer was kept. */
    kept?: EffectResult | undefined
}

/**
 * The effects port as an in-memory ledger for acts whose answer is kept (`keep` / `from`): a key with a kept result answers it and
 * does not act again; otherwise the act is made (a lost outcome is acted again: the effect is `repeatable`) and its answer is kept.
 * `failNext(key, error)` makes the next act under a key throw, to kill a run at that step. A spec binds it to the port:
 * `const effects = mock<Effects>(); effects.once.mockImplementation(ledger.once)`.
 */
export const keptEffectsLedger = () => {
    const rows = new Map<string, KeptEffectRow>()
    const failures = new Map<string, Error>()
    const once = async <T>(key: string, _effect: JobEffectDeclaration, call: EffectCallKept<T>): Promise<T> => {
        const row = rows.get(key) ?? { acts: 0 }
        rows.set(key, row)
        if (row.kept !== undefined) return call.from(row.kept)
        const failure = failures.get(key)
        if (failure !== undefined) {
            failures.delete(key)
            throw failure
        }
        row.acts += 1
        const answer = await call.act()
        row.kept = call.keep(answer)
        return answer
    }
    return {
        once,
        rows,
        failNext: (key: string, error: Error): void => {
            failures.set(key, error)
        },
    }
}
