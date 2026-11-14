import { FakeClock, mock } from "@starci/jest-preset"
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import type { QueueDelivery } from "@modules/platform/queue"
import { REVIEW_DOSSIERS_JOB } from "@modules/queues/knowledge"
import { aiDeliveryOf, aiRunnerHarness } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { answered, buildCriticSubject, rowOf, sectionsOf } from "@tests/fixtures/builders/dossier-review-critic.builder"
import { NOW, SRC, WS } from "@tests/fixtures/builders/dossier-review-world.builder"
import { DossierReviewRunnerService } from "./dossier-review-runner.service"
import { DossierReviewRunsService } from "./dossier-review-runs.service"
import { runStore } from "./dossier-review.testing"
import { ReviewCriticService } from "./review-critic.service"

const PAYLOAD = { runId: "r1", workspaceId: WS }
const LONG = sectionsOf(60)

/** The processor of the review job as the feature composes it: one domain method; the dead letter closes the run and lets its documents go on. */
class ReviewProcessor extends FencedProcessor {
    override readonly queue = "knowledge"
    override readonly definition = REVIEW_DOSSIERS_JOB
    constructor(private readonly runner: DossierReviewRunnerService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.runner.run(job)
    }
    override async onFailed(delivery: QueueDelivery): Promise<void> {
        await this.runner.fail(delivery.payload)
    }
}

const build = async () => {
    const subject = await buildCriticSubject()
    subject.world.upload(LONG)
    await subject.critic.request(WS, SRC)
    const store = runStore("queued")
    const settle = mock<ReviewCriticService>()
    const runner = new DossierReviewRunnerService(store.em, new FakeClock(NOW), settle, subject.critic, mock<DossierReviewRunsService>())
    return { subject, store, settle, processor: new ReviewProcessor(runner) }
}

describe("dossier review chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("the model is down on every start: 5 / 10 / 20 s, then ONE item; the run is closed failed, NO critique runs in the failure hook, the document stays at its typed state; a resume takes it back and finishes", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        h.claimed(PAYLOAD)

        // The model never answers (the scripted model is down when its script is empty): starts 1..3 are tried again by the ladder.
        for (const attempt of [1, 2, 3]) {
            await expect(h.runner.run(t.processor, aiDeliveryOf("knowledge", REVIEW_DOSSIERS_JOB.name, PAYLOAD, attempt))).rejects.toMatchObject({
                code: "QUEUE_RETRY_AFTER",
                params: { seconds: [5, 10, 20][attempt - 1] },
            })
        }
        expect(h.claims.park).not.toHaveBeenCalled()
        const callsBeforePark = t.subject.model.critique.mock.calls.length

        await h.runner.run(t.processor, aiDeliveryOf("knowledge", REVIEW_DOSSIERS_JOB.name, PAYLOAD, 4))

        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "knowledge" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", failureClass: "transient", workspaceId: WS }))
        // The failure hook closed the run and lets its documents go on; it made NO model call (one call per start, none in the hook).
        expect(t.store.run).toMatchObject({ status: "failed", error: "job_failed" })
        expect(t.settle.settle).toHaveBeenCalledWith(WS, "r1")
        expect(t.subject.model.critique.mock.calls.length).toBe(callsBeforePark + 1)
        expect(rowOf(t.subject)).toMatchObject({ state: "not_done", reason: "model" })

        // The cause is fixed and a person presses "run again": the run is reopened, the critique handed back, and the document is read.
        const resumed = await aiRunnerHarness(1)
        resumed.claimed(PAYLOAD)
        for (let call = 0; call < 6; call += 1) t.subject.script.push(() => answered([]))

        await resumed.runner.run(t.processor, aiDeliveryOf("knowledge", REVIEW_DOSSIERS_JOB.name, PAYLOAD, 1))

        expect(rowOf(t.subject)).toMatchObject({ state: "done", reason: null })
        expect(t.store.run.status).toBe("done")
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.claims.park).not.toHaveBeenCalled()
    })

    it("an answer the model gives unreadable twice is a refusal no retry changes: the job parks at once (input) with ONE item", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        h.claimed(PAYLOAD)
        t.subject.model.critique.mockImplementation(() => Promise.resolve({ ok: false as const, reason: "unreadable" as const }))

        await h.runner.run(t.processor, aiDeliveryOf("knowledge", REVIEW_DOSSIERS_JOB.name, PAYLOAD, 1))

        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "DOSSIER_REVIEW_MODEL_REFUSED" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.store.run.status).toBe("failed")
    })
})
