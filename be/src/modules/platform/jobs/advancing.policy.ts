import type { ClaimedJob } from "./jobs.contracts"
import type { JobClaims } from "./jobs.port"

/** Records one claimed job's step before its domain effect can start. */
export abstract class AdvancingJobStepPolicy {
    /** Binds the claim writer and the recorded name of this step. */
    protected constructor(
        private readonly claims: JobClaims,
        private readonly step: string,
    ) {}

    /** Rejects a stale fencing token before invoking the step's effect, then waits for that effect to finish. */
    async run(job: ClaimedJob): Promise<void> {
        await this.claims.advance({ jobId: job.jobId, expectedFencingToken: job.fencingToken, step: this.step })
        await this.perform(job.payload, job)
    }

    /** Performs the domain effect after the worker's claim has been checked; the claimed job is the second argument for a step whose effect keys its outside acts or reports its progress by the job. */
    protected abstract perform(payload: object, job: ClaimedJob): Promise<unknown>
}
