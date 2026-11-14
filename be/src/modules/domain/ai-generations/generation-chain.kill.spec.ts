import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { AI } from "@modules/integrations/ai"
import type { AiChatAnswer, AiService } from "@modules/integrations/ai"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import { aiChainProviders, aiKilled, claimedAiJob } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { generationRow } from "@tests/fixtures/builders/ai-generations.builder"
import { queueQueryBuilders } from "@tests/fixtures/builders/entity-query-builder.builder"
import { AI_GENERATIONS_USAGE } from "./ai-generations.decorators"
import type { UsageGate } from "./ai-generations.port"
import { GenerationRunnerService } from "./generation-runner.service"
import { AiGenerationEntity } from "./persistence/entities"

const PAYLOAD = { generationId: "g1", workspaceId: "w1" }

const ANSWER: AiChatAnswer = {
    text: "hello",
    parsed: null,
    model: "m",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.1 },
    retrieved: 0,
}

describe("generation chain: the job is run twice, the second run calls and bills the model no second time", () => {
    const build = async () => {
        const chain = aiChainProviders()
        const em = mockEntityManager({
            findOne: [AiGenerationEntity, generationRow({ status: "queued" })],
            update: [AiGenerationEntity, { affected: 1 }],
        })
        fakeTransaction(em)
        const ai = mock<AiService>({
            available: jest.fn(() => true),
            attempt: jest.fn(() => Promise.resolve({ ok: true as const, answer: ANSWER })),
        })
        const usage = mock<UsageGate>({
            record: jest.fn(() => Promise.resolve()),
            blockedBy: jest.fn(() => Promise.resolve(null)),
        })
        const moduleRef = await Test.createTestingModule({
            providers: [
                ...chain.providers,
                GenerationRunnerService,
                { provide: PRIMARY_ENTITY_MANAGER, useValue: em },
                { provide: CLOCK, useValue: new FakeClock("2026-10-12T10:00:00.000Z") },
                { provide: LOGGER, useValue: mock<Logger>() },
                { provide: AI_GENERATIONS_USAGE, useValue: usage },
                { provide: AI, useValue: ai },
            ],
        }).compile()
        return { runner: moduleRef.get(GenerationRunnerService), em, ai, usage, chain }
    }

    it("a kill after the model answered and before the row was written: the second run answers from the ledger, writes the text once and meters it once", async () => {
        const t = await build()
        const job = claimedAiJob(PAYLOAD, { kind: "agents.generate" })
        // The worker is gone when it writes the answer on the row: the first finishing transaction never runs.
        t.em.transaction.mockRejectedValueOnce(aiKilled())

        await expect(t.runner.runJob(job)).rejects.toMatchObject({ code: "ECONNRESET" })

        expect(t.ai.attempt).toHaveBeenCalledTimes(1)
        expect(t.chain.ledger.settled()).toEqual(["job-1:generate"])
        expect(t.usage.record).not.toHaveBeenCalled()

        // The row still waits (running, nothing written): the same job runs again.
        const [finisher] = queueQueryBuilders(t.em, [{ execute: { raw: [{ usage_kind: "relay", module: "office" }] } }])
        t.em.findOne.mockResolvedValue(generationRow({ status: "running" }))
        await expect(t.runner.runJob(job)).resolves.toBeUndefined()

        // The model was NOT called again and is billed once: the ledger kept the first answer.
        expect(t.ai.attempt).toHaveBeenCalledTimes(1)
        expect(t.chain.ledger.rows.get("job-1:generate")?.acts).toBe(1)
        expect(finisher?.callsOf("set")).toEqual([[expect.objectContaining({ status: "done", output: { text: "hello" } })]])
        expect(t.usage.record).toHaveBeenCalledTimes(1)
        expect(t.usage.record).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w1", completionChars: 5 }))
    })

    it("a caller that waits in its own process keys the call by its own key: its second run takes the first answer", async () => {
        const t = await build()
        const [first, second] = queueQueryBuilders(t.em, [
            { execute: { raw: [{ usage_kind: "relay", module: "office" }] } },
            { execute: { raw: [{ usage_kind: "relay", module: "office" }] } },
        ])

        await expect(t.runner.run(PAYLOAD, "job-7:turn")).resolves.toBe("done")
        await expect(t.runner.run(PAYLOAD, "job-7:turn")).resolves.toBe("done")

        expect(t.ai.attempt).toHaveBeenCalledTimes(1)
        expect(first?.callsOf("set")).toHaveLength(1)
        expect(second?.callsOf("set")).toHaveLength(1)
    })
})
