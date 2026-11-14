import { Injectable } from "@nestjs/common"
import { In, type EntityManager } from "typeorm"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import type { ClaimedJob } from "@modules/platform/jobs"
import { isDossierReviewPayload, type DossierReviewPayload } from "@modules/queues/knowledge"
import { JOB_FAILED, type JobOutcome } from "./dossier-review.contracts"
import { DocumentCriticService } from "./document-critic.service"
import { DossierReviewRunsService } from "./dossier-review-runs.service"
import { DossierReviewError, DossierReviewErrorCode } from "./errors/dossier-review.error"
import { DossierReviewRunEntity } from "./persistence/entities"
import { ReviewCriticService } from "./review-critic.service"

@Injectable()
/** Carries out a run: claims it, runs one batch of the shop-document critiques that wait, ends the run and lets its documents go on. */
export class DossierReviewRunnerService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
        private readonly critic: ReviewCriticService,
        private readonly documentCritic: DocumentCriticService,
        private readonly runs: DossierReviewRunsService,
    ) {}

    /**
     * Runs the run a claimed job names; a run that ended already changes nothing. The critiques the model could not read are handed
     * back first (a job run again by the ladder takes back the ones that failed since this run began; a job a person handed back after
     * its dead letter takes back every one of the workspace). The run ends AFTER its critiques, and when more critiques wait than one
     * run carries out its follow-up run is queued in the transaction that ends it. A failure is thrown: the job's ladder and dead
     * letter decide, and the run stays `running` (this job's) until then.
     */
    async run(job: ClaimedJob): Promise<JobOutcome> {
        const payload = job.payload
        if (!isDossierReviewPayload(payload)) throw new DossierReviewError({ code: DossierReviewErrorCode.PayloadInvalid })
        const resumed = (job.resumeCount ?? 0) > 0
        if (resumed) await this.reopen(payload)
        const run = await this.claim(payload.workspaceId, payload.runId, this.clock.now())
        if (run === null) {
            await this.critic.settle(payload.workspaceId, payload.runId)
            return "skipped"
        }
        await this.documentCritic.retryFailed(run.workspaceId, resumed ? null : run.startedAt)
        // The shop-document critic of every document waiting for it, before the documents leave the `critic` stage.
        const ran = await this.documentCritic.runWaiting(run.workspaceId, job)
        await this.ended(run, ran)
        await this.critic.settle(run.workspaceId, run.id)
        return "done"
    }

    /**
     * The job was dead-lettered (one item for a person): the run, while queued or running, ends failed with its error and the documents
     * waiting for the critic stop waiting. No critique runs here: a resume of the job reopens the run and takes its critiques back.
     */
    async fail(payload: object): Promise<void> {
        if (!isDossierReviewPayload(payload)) return
        await this.entityManager.update(
            DossierReviewRunEntity,
            { id: payload.runId, workspaceId: payload.workspaceId, status: In(["queued", "running"]) },
            { status: "failed", finishedAt: this.clock.now(), error: JOB_FAILED },
        )
        await this.critic.settle(payload.workspaceId, payload.runId)
    }

    /**
     * Ends the run, and, when critiques still wait after a batch that ran some, queues the follow-up run in the same transaction (so no
     * critique waits for a request that may never come). The follow-up never spins: a critique that ended without progress is
     * `not_done`, not waiting, and a batch that ran nothing queues no follow-up (the next request or upkeep tick asks again).
     */
    private ended(run: DossierReviewRunEntity, ran: number): Promise<void> {
        return this.entityManager.transaction(async (tx) => {
            await tx.update(
                DossierReviewRunEntity,
                { id: run.id, workspaceId: run.workspaceId },
                { status: "done", finishedAt: this.clock.now() },
            )
            if (ran > 0 && (await this.documentCritic.hasWaiting(run.workspaceId))) await this.runs.continueCritiquesIn(tx, run.workspaceId)
        })
    }

    /** Opens the run the dead letter's hook closed, so the job a person handed back carries it out. */
    private async reopen(payload: DossierReviewPayload): Promise<void> {
        await this.entityManager.update(
            DossierReviewRunEntity,
            { id: payload.runId, workspaceId: payload.workspaceId, status: "failed", error: JOB_FAILED },
            { status: "queued", error: null, finishedAt: null },
        )
    }

    /**
     * Takes a queued run, or the run this job already holds (`running`: a run again by the ladder or by a person); null when it ended or
     * is gone. The job's own claim fences it: one job per run row.
     */
    private claim(workspaceId: string, runId: string, now: Date): Promise<DossierReviewRunEntity | null> {
        return this.entityManager.transaction(async (tx) => {
            const row = await tx.findOne(DossierReviewRunEntity, {
                where: { id: runId, workspaceId },
                lock: { mode: "pessimistic_write" },
            })
            if (row === null || (row.status !== "queued" && row.status !== "running")) return null
            if (row.status === "running") return row
            await tx.update(DossierReviewRunEntity, { id: row.id, workspaceId }, { status: "running", startedAt: now })
            return { ...row, status: "running", startedAt: now }
        })
    }
}
