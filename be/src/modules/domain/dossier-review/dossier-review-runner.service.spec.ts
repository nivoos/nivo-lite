import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { In } from "typeorm"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { claimedAiJob } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { DocumentCriticService } from "./document-critic.service"
import { DossierReviewRunnerService } from "./dossier-review-runner.service"
import { DossierReviewRunsService } from "./dossier-review-runs.service"
import { DossierReviewErrorCode } from "./errors/dossier-review.error"
import { DossierReviewRunEntity } from "./persistence/entities"
import { ReviewCriticService } from "./review-critic.service"

const WS = "11111111-1111-4111-8111-111111111111"
const NOW = "2026-10-31T10:00:00.000Z"
const PAYLOAD = { runId: "r1", workspaceId: WS }
const JOB = claimedAiJob(PAYLOAD, { kind: "dossier.review" })

/** A run row in a state, started at an instant. */
const runOf = (status: DossierReviewRunEntity["status"], startedAt: Date | null = null): DossierReviewRunEntity =>
    Object.assign(new DossierReviewRunEntity(), {
        id: "r1",
        workspaceId: WS,
        scope: "workspace",
        dossierId: null,
        trigger: "document",
        triggerRef: "s1",
        status,
        requestedBy: null,
        aiState: null,
        stats: {},
        error: null,
        startedAt,
        finishedAt: null,
    })

const build = async (run: DossierReviewRunEntity | null = runOf("queued")) => {
    const tx = fakeTransaction(
        mockEntityManager({
            findOne: [DossierReviewRunEntity, run],
            update: [DossierReviewRunEntity, { affected: 1 }],
        }),
    )
    const em: MockEntityManager = tx.em
    const critic = mock<ReviewCriticService>()
    const documentCritic = mock<DocumentCriticService>({
        runWaiting: jest.fn().mockResolvedValue(0),
        hasWaiting: jest.fn().mockResolvedValue(false),
        retryFailed: jest.fn().mockResolvedValue(0),
    })
    const runs = mock<DossierReviewRunsService>()
    const moduleRef = await Test.createTestingModule({
        providers: [
            DossierReviewRunnerService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            { provide: ReviewCriticService, useValue: critic },
            { provide: DocumentCriticService, useValue: documentCritic },
            { provide: DossierReviewRunsService, useValue: runs },
        ],
    }).compile()
    return { service: moduleRef.get(DossierReviewRunnerService), em, tx, critic, documentCritic, runs }
}

describe("DossierReviewRunnerService run: the claim", () => {
    it("refuses a payload of another shape with a typed error (the job's declaration refuses it before this)", async () => {
        const { service, em } = await build()

        await expect(service.run(claimedAiJob({ draftId: "x" }))).rejects.toMatchObject({ code: DossierReviewErrorCode.PayloadInvalid })
        expect(em.transaction).not.toHaveBeenCalled()
    })

    it("skips a run that is gone or ended, and still lets its documents go on", async () => {
        for (const run of [null, runOf("done"), runOf("failed")]) {
            const { service, critic, documentCritic } = await build(run)
            await expect(service.run(JOB)).resolves.toBe("skipped")
            expect(documentCritic.runWaiting).not.toHaveBeenCalled()
            expect(critic.settle).toHaveBeenCalledWith(WS, "r1")
        }
    })

    it("claims a queued run, and takes back the run this job already holds (running: a run again by the ladder)", async () => {
        const first = await build(runOf("queued"))
        await expect(first.service.run(JOB)).resolves.toBe("done")
        expect(first.em.update).toHaveBeenNthCalledWith(1, DossierReviewRunEntity, { id: "r1", workspaceId: WS }, { status: "running", startedAt: new Date(NOW) })

        const again = await build(runOf("running", new Date("2026-10-31T09:59:00.000Z")))
        await expect(again.service.run(JOB)).resolves.toBe("done")
        // The run it holds is not claimed again: only its end is written.
        expect(again.em.update).toHaveBeenCalledTimes(1)
        expect(again.em.update).toHaveBeenCalledWith(DossierReviewRunEntity, { id: "r1", workspaceId: WS }, { status: "done", finishedAt: new Date(NOW) })
    })

    it("ends the run AFTER its critiques, and lets its documents go on", async () => {
        const { service, em, critic, documentCritic } = await build()
        const order: Array<string> = []
        documentCritic.runWaiting.mockImplementation(() => {
            order.push("critiques")
            return Promise.resolve(1)
        })
        em.update.mockImplementation((_entity, _where, changes) => {
            order.push(JSON.stringify(changes).includes("done") ? "done" : "running")
            return Promise.resolve({ affected: 1, raw: [], generatedMaps: [] })
        })

        await service.run(JOB)

        expect(order).toEqual(["running", "critiques", "done"])
        expect(documentCritic.runWaiting).toHaveBeenCalledWith(WS, JOB)
        expect(critic.settle).toHaveBeenCalledWith(WS, "r1")
    })
})

describe("DossierReviewRunnerService run: the critiques the model could not read", () => {
    it("a job run again by the ladder takes back the ones that failed since this run began", async () => {
        const started = new Date("2026-10-31T09:59:00.000Z")
        const { service, documentCritic } = await build(runOf("running", started))

        await service.run(JOB)

        expect(documentCritic.retryFailed).toHaveBeenCalledWith(WS, started)
    })

    it("a job a person handed back after its dead letter reopens the failed run and takes back every one of the workspace", async () => {
        const { service, em, documentCritic } = await build(runOf("failed"))
        em.findOne.mockResolvedValueOnce(runOf("queued"))

        await service.run(claimedAiJob(PAYLOAD, { kind: "dossier.review", resumeCount: 1 }))

        expect(em.update).toHaveBeenNthCalledWith(
            1,
            DossierReviewRunEntity,
            { id: "r1", workspaceId: WS, status: "failed", error: "job_failed" },
            { status: "queued", error: null, finishedAt: null },
        )
        expect(documentCritic.retryFailed).toHaveBeenCalledWith(WS, null)
    })

    it("throws what a critique failed with, leaves the run running (this job's) and writes no end", async () => {
        const { service, em, documentCritic, critic } = await build()
        const outage = new Error("model down")
        documentCritic.runWaiting.mockRejectedValue(outage)

        await expect(service.run(JOB)).rejects.toBe(outage)

        expect(em.update).toHaveBeenCalledTimes(1)
        expect(critic.settle).not.toHaveBeenCalled()
    })
})

describe("DossierReviewRunnerService run: the follow-up (D-V-3)", () => {
    it("queues a follow-up run in the transaction that ends the run when shop-document critiques still wait after its batch", async () => {
        const { service, tx, documentCritic, runs } = await build()
        documentCritic.runWaiting.mockResolvedValue(2)
        documentCritic.hasWaiting.mockResolvedValue(true)

        await service.run(JOB)

        expect(runs.continueCritiquesIn).toHaveBeenCalledWith(expect.anything(), WS)
        expect(tx.commits).toBe(2)
    })

    it("never spins: a batch that ran nothing queues none, and a critique that ended without progress asks for none", async () => {
        const idle = await build()
        idle.documentCritic.runWaiting.mockResolvedValue(0)
        idle.documentCritic.hasWaiting.mockResolvedValue(true)
        await idle.service.run(JOB)
        expect(idle.runs.continueCritiquesIn).not.toHaveBeenCalled()

        const spent = await build()
        spent.documentCritic.runWaiting.mockResolvedValue(1)
        spent.documentCritic.hasWaiting.mockResolvedValue(false)
        await spent.service.run(JOB)
        expect(spent.runs.continueCritiquesIn).not.toHaveBeenCalled()
    })
})

describe("DossierReviewRunnerService fail", () => {
    it("ends a queued or running run failed and lets its documents go on: NO critique runs in the failure hook", async () => {
        const { service, em, critic, documentCritic } = await build()

        await service.fail({ nope: true })
        await service.fail(PAYLOAD)

        expect(em.update).toHaveBeenCalledTimes(1)
        expect(em.update).toHaveBeenCalledWith(
            DossierReviewRunEntity,
            { id: "r1", workspaceId: WS, status: In(["queued", "running"]) },
            { status: "failed", finishedAt: new Date(NOW), error: "job_failed" },
        )
        expect(documentCritic.runWaiting).not.toHaveBeenCalled()
        expect(critic.settle).toHaveBeenCalledWith(WS, "r1")
    })
})
