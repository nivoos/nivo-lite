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
} from "@modules/platform/jobs"
import { JOBS_OPTIONS } from "@modules/platform/jobs/jobs.decorators"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { QUEUE_WORKER_REGISTRY } from "@modules/platform/queue"
import type { QueueDelivery, QueueWorkerRegistry } from "@modules/platform/queue"

/** A delivery of one job of a queue on its `attempt`-th start, as the queue hands it to the runner. */
export const deliveryOf = (queue: string, job: string, payload: object, attempt: number, id = "k-1"): QueueDelivery => ({
    id,
    queue,
    job,
    payload,
    attempt,
    signal: new AbortController().signal,
})

/** What the network says when nothing answers: the classifier calls it transient. */
export const refusedByNetwork = (): Error => Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:25"), { code: "ECONNREFUSED" })

/**
 * The runner of fenced jobs over a claims double: the real classifier, the real ladders, the real dead-letter path. `resumeCount` above
 * 0 makes every claim a resume of a parked job. `claimed(payload)` makes the next claim answer a job with this payload (`job-1`).
 */
export const buildJobRunner = async (resumeCount = 0) => {
    const claims = mock<JobClaims>()
    const job = (payload: object): ClaimedJob => ({
        jobId: "job-1",
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
    claims.retryAfterSeconds.mockResolvedValue(null)
    claims.advance.mockResolvedValue(undefined)
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
    return { runner: moduleRef.get(JobRunnerService), claims, deadLetters, claimed: (payload: object) => claims.claim.mockResolvedValue(job(payload)) }
}
