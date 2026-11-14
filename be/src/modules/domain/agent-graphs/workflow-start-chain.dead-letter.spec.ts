import { buildInboundRunner } from "@tests/fixtures/builders/inbound-chain.builder"
import { answers, START, startChain } from "@tests/fixtures/builders/workflow-start-chain.builder"

describe("workflow start chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("a start nobody took is not dropped: the job parks at once with ONE item, nothing is claimed, and after the workflow runs again the resume starts it", async () => {
        const h = await buildInboundRunner()
        const t = startChain()
        h.claim(START)
        // The workflow was paused between the press and the delivery: no live registration takes the event.
        t.triggers.deliver.mockImplementation(() => t.answer(answers.untaken))

        await h.run(t.processor, START, 1)

        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(
            expect.objectContaining({ failureClass: "input", reason: "AGENT_GRAPHS_WORKFLOW_START_UNTAKEN", queue: "workflow_start" }),
        )
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", failureClass: "input", jobId: "job-1" }))
        // The delivery ran inside a transaction that rolled back: the pipeline holds no event of this start.
        expect(t.tx.rollbacks).toBe(1)
        expect(t.tx.commits).toBe(0)
        expect(t.state.wakes).toBe(0)
        expect(h.claims.complete).not.toHaveBeenCalled()

        // The founder turned the workflow on again and resumes the job.
        t.triggers.deliver.mockImplementation(() => t.answer(answers.taken))
        const resumed = await buildInboundRunner(1)
        resumed.claim(START)
        await resumed.run(t.processor, START, 1)

        expect(t.state.wakes).toBe(1)
        expect(t.tx.commits).toBe(1)
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.deadLetters.raise).not.toHaveBeenCalled()
    })
})
