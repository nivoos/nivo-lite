import { buildInboundRunner, refused } from "@tests/fixtures/builders/inbound-chain.builder"
import { answers, START, startChain } from "@tests/fixtures/builders/workflow-start-chain.builder"

describe("workflow start chain: the delivery job is run twice, the second run repeats no finished step", () => {
    it("a kill while the start is handed to the pipeline: the transaction rolls back, the second run starts the workflow once, and a redelivery is a normal end that starts nothing", async () => {
        const h = await buildInboundRunner()
        const t = startChain()
        h.claim(START)
        t.triggers.deliver.mockRejectedValueOnce(refused())

        await expect(h.run(t.processor, START, 1)).rejects.toMatchObject({ params: { seconds: 60 } })

        expect(t.tx.rollbacks).toBe(1)
        expect(t.state.wakes).toBe(0)
        expect(h.claims.complete).not.toHaveBeenCalled()

        await h.run(t.processor, START, 2)

        expect(t.state.wakes).toBe(1)
        expect(h.claims.complete).toHaveBeenCalledTimes(1)

        // The same start again: the pipeline already holds the event, so it answers a repeat; the job ends normally and wakes nothing.
        t.triggers.deliver.mockImplementation(() => t.answer(answers.repeat))
        await h.run(t.processor, START, 1)

        expect(t.state.wakes).toBe(1)
        expect(h.claims.park).not.toHaveBeenCalled()
        expect(h.deadLetters.raise).not.toHaveBeenCalled()
    })
})
