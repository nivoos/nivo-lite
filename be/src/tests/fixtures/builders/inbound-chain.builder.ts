import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { Effects, EffectResult } from "@modules/platform/effects"
import {
    JOB_CLAIMS,
    JobDeadLettersService,
    JobRenewalService,
    JobRunnerService,
    JobStateEventsService,
    type ClaimedJob,
    type FencedProcessor,
    type JobClaims,
} from "@modules/platform/jobs"
import { JOBS_OPTIONS } from "@modules/platform/jobs/jobs.decorators"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_WORKER_REGISTRY, QueueError, QueueErrorCode } from "@modules/platform/queue"
import type { QueueDelivery, QueueWorkerRegistry } from "@modules/platform/queue"

/** The id of the job row every spec of an inbound chain runs under. */
export const INBOUND_JOB_ID = "job-1"

/** The delivery the broker hands the runner for the `attempt`-th start of a job (a retry is the next attempt of the same delivery id). */
export const deliveryOf = (queue: string, job: string, payload: object, attempt: number): QueueDelivery => ({
    id: "k-1",
    queue,
    job,
    payload,
    attempt,
    signal: new AbortController().signal,
})

/** What the network says when nothing answers: the classifier calls it transient. */
export const refused = (): Error => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" })

/** The runner of fenced jobs over a claims double: the real classifier, the real ladders, the real dead-letter path. `resumeCount` above 0 is a person's resume. */
export const buildInboundRunner = async (resumeCount = 0) => {
    const claims = mock<JobClaims>()
    const claimed = (payload: object): ClaimedJob => ({
        jobId: INBOUND_JOB_ID,
        kind: "x",
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
    const runner = moduleRef.get(JobRunnerService)
    return {
        runner,
        claims,
        deadLetters,
        /** Makes the claim hand out the job row of this payload. */
        claim: (payload: object): void => {
            claims.claim.mockResolvedValue(claimed(payload))
        },
        /** One delivery of the processor's job at its `attempt`-th start. */
        run: (processor: FencedProcessor, payload: object, attempt: number): Promise<void> =>
            runner.run(processor, deliveryOf(processor.queue, processor.definition?.name ?? processor.queue, payload, attempt)),
    }
}

/** One effect the kept-result ledger holds: how often its act was made, and the result the key was settled with. */
export interface KeptEffectRow {
    /** How many times the act was made under the key. */
    acts: number
    /** The result kept on settle, or undefined while the key is an intent or kept nothing. */
    kept?: EffectResult | undefined
    /** True once the act answered. */
    settled: boolean
}

/**
 * The effects port as an in-memory ledger with the semantics of the real piece for a call that KEEPS its answer: a key settled with a kept
 * result answers it and does not act again (the channel's address of a file may have expired); a key whose act threw is released and acts
 * again; an act that never answered leaves no result. A spec reads `rows` to see how often each key acted.
 */
export const keptEffectsLedger = () => {
    const rows = new Map<string, KeptEffectRow>()
    const once = async (
        key: string,
        _effect: unknown,
        call: { readonly act: () => Promise<unknown>; readonly keep?: (answer: never) => EffectResult; readonly from?: (kept: EffectResult) => unknown },
    ): Promise<unknown> => {
        const row = rows.get(key) ?? { acts: 0, settled: false }
        rows.set(key, row)
        if (row.settled && call.from !== undefined && row.kept !== undefined) return call.from(row.kept)
        row.acts += 1
        const answer = await call.act()
        row.settled = true
        if (call.keep === undefined) return undefined
        row.kept = call.keep(answer as never)
        return answer
    }
    const effects = { once, settleIn: () => Promise.resolve() } as unknown as Effects
    return { effects, rows }
}

/** The pause, in seconds, a failed delivery was handed back to the queue with (the runner's `RetryAfter`), or undefined for any other outcome. */
export const pauseOf = (outcome: unknown): number | undefined => {
    if (!(outcome instanceof QueueError) || outcome.code !== QueueErrorCode.RetryAfter) return undefined
    const { seconds } = outcome.params
    return typeof seconds === "number" ? seconds : undefined
}
