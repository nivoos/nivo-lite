import { FakeClock, mock } from "@starci/jest-preset"
import { aiKilled, claimedAiJob } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { answered, buildCriticSubject, rowOf, sectionsOf } from "@tests/fixtures/builders/dossier-review-critic.builder"
import { NOW, SRC, WS } from "@tests/fixtures/builders/dossier-review-world.builder"
import { runStore } from "./dossier-review.testing"
import { DossierReviewRunnerService } from "./dossier-review-runner.service"
import { DossierReviewRunsService } from "./dossier-review-runs.service"
import { ReviewCriticService } from "./review-critic.service"

const LONG = sectionsOf(60)

describe("dossier review chain: the job is run twice, the second run repeats no finished critique call", () => {
    it("a kill in the middle of a critique: the passages the finished call read are not read again; the second run (the same job) takes the critique back and ends the run once", async () => {
        const subject = await buildCriticSubject()
        subject.world.upload(LONG)
        await subject.critic.request(WS, SRC)
        const store = runStore("queued")
        const runs = mock<DossierReviewRunsService>()
        const runner = new DossierReviewRunnerService(store.em, new FakeClock(NOW), mock<ReviewCriticService>(), subject.critic, runs)
        const job = claimedAiJob({ runId: "r1", workspaceId: WS }, { kind: "dossier.review" })
        // Call 1 answers; the worker is gone during call 2 (the model call throws what a dead connection throws).
        subject.script.push(() => answered([]), () => {
            throw aiKilled()
        })

        await expect(runner.run(job)).rejects.toMatchObject({ code: "ECONNRESET" })

        const first = subject.bundles[0]?.changed.map((item) => item.text) ?? []
        expect(first.length).toBeGreaterThan(0)
        expect(store.run.status).toBe("running")
        expect(rowOf(subject)).toMatchObject({ state: "not_done", reason: "model" })

        subject.script.push(() => answered([]), () => answered([]), () => answered([]), () => answered([]), () => answered([]))
        await expect(runner.run(job)).resolves.toBe("done")

        // Every passage was read by a call that answered exactly once: the passages of the first call were NOT read again.
        const reread = subject.bundles.slice(2).flatMap((bundle) => bundle.changed.map((item) => item.text))
        expect(reread.some((text) => first.includes(text))).toBe(false)
        expect(first.length + reread.length).toBe(subject.world.chunks.length)
        expect(rowOf(subject)).toMatchObject({ state: "done", reason: null })
        expect(store.run.status).toBe("done")
    })
})
