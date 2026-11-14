import { Test } from "@nestjs/testing"
import { FakeClock, fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { AI } from "@modules/integrations/ai"
import type { AiChatAnswer, AiService } from "@modules/integrations/ai"
import { CLOCK } from "@modules/platform/clock"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { FencedProcessor, type ClaimedJob } from "@modules/platform/jobs"
import { LOGGER } from "@modules/platform/logging"
import type { Logger } from "@modules/platform/logging"
import type { QueueDelivery } from "@modules/platform/queue"
import { GENERATE_JOB } from "@modules/queues/agents"
import { aiChainProviders, aiDeliveryOf, aiOutage, aiRunnerHarness } from "@tests/fixtures/builders/brain-ai-effects.builder"
import { generationRow } from "@tests/fixtures/builders/ai-generations.builder"
import { queueQueryBuilders } from "@tests/fixtures/builders/entity-query-builder.builder"
import { AI_GENERATIONS_USAGE } from "./ai-generations.decorators"
import type { UsageGate } from "./ai-generations.port"
import { GenerationRunnerService } from "./generation-runner.service"
import { AiGenerationEntity } from "./persistence/entities"

const WS = "11111111-1111-4111-8111-111111111111"
const PAYLOAD = { generationId: "g1", workspaceId: WS }

const ANSWER: AiChatAnswer = {
    text: "hello",
    parsed: null,
    model: "m",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, costUsd: 0.1 },
    retrieved: 0,
}

/** The processor of the generate job as the feature composes it: one domain method, the dead letter closes the row's wait. */
class GenerateProcessor extends FencedProcessor {
    override readonly queue = "agents"
    override readonly definition = GENERATE_JOB
    constructor(private readonly runner: GenerationRunnerService) {
        super()
    }
    async process(job: ClaimedJob): Promise<void> {
        await this.runner.runJob(job)
    }
    override async onFailed(delivery: QueueDelivery): Promise<void> {
        await this.runner.closeOpen(delivery.payload)
    }
}

const build = async (row = generationRow({ status: "queued" })) => {
    const chain = aiChainProviders()
    const em = mockEntityManager({ findOne: [AiGenerationEntity, row], update: [AiGenerationEntity, { affected: 1 }] })
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
    return { processor: new GenerateProcessor(moduleRef.get(GenerationRunnerService)), em, ai, usage }
}

describe("generation chain: a failure ends as a bounded retry (transient only), then ONE dead letter, and a resume finishes", () => {
    it("the database is down on every start: 5 / 10 / 20 s, then the job parks with ONE item and closes the row its caller polls; a resume reopens and finishes it", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        h.claimed(PAYLOAD)
        t.em.findOne.mockRejectedValue(aiOutage())

        // Starts 1..3 are tried again by the queue on the background ladder.
        for (const attempt of [1, 2, 3]) {
            await expect(h.runner.run(t.processor, aiDeliveryOf("agents", GENERATE_JOB.name, PAYLOAD, attempt))).rejects.toMatchObject({
                code: "QUEUE_RETRY_AFTER",
                params: { seconds: [5, 10, 20][attempt - 1] },
            })
        }
        expect(h.claims.fail).toHaveBeenCalledTimes(3)
        expect(h.claims.park).not.toHaveBeenCalled()

        // The 4th start fails too: a dead letter with one item; the failure hook closes the waiting row with `job_failed`.
        await h.runner.run(t.processor, aiDeliveryOf("agents", GENERATE_JOB.name, PAYLOAD, 4))
        expect(h.claims.park).toHaveBeenCalledTimes(1)
        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient", queue: "agents" }))
        expect(h.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(h.deadLetters.raise).toHaveBeenCalledWith(expect.objectContaining({ kind: "flow-parked", failureClass: "transient", workspaceId: WS }))
        expect(t.em.update).toHaveBeenCalledWith(
            AiGenerationEntity,
            expect.objectContaining({ id: "g1", workspaceId: WS }),
            expect.objectContaining({ status: "error", error: "job_failed" }),
        )
        expect(t.ai.attempt).not.toHaveBeenCalled()

        // The cause is fixed and a person presses "run again": the job reopens the row its hook closed and finishes it.
        const resumed = await aiRunnerHarness(1)
        resumed.claimed(PAYLOAD)
        t.em.findOne.mockResolvedValue(generationRow({ status: "queued" }))
        const [finisher] = queueQueryBuilders(t.em, [{ execute: { raw: [{ usage_kind: "relay", module: "office" }] } }])

        await resumed.runner.run(t.processor, aiDeliveryOf("agents", GENERATE_JOB.name, PAYLOAD, 1))

        expect(t.em.update).toHaveBeenCalledWith(
            AiGenerationEntity,
            { id: "g1", workspaceId: WS, status: "error", error: "job_failed" },
            { status: "queued", error: null, finishedAt: null },
        )
        expect(finisher?.callsOf("set")).toEqual([[expect.objectContaining({ status: "done", output: { text: "hello" } })]])
        expect(resumed.claims.complete).toHaveBeenCalledTimes(1)
        expect(resumed.claims.park).not.toHaveBeenCalled()
        expect(t.ai.attempt).toHaveBeenCalledTimes(1)
    })

    it("a model that does not answer is the typed end of the row, not a failure of the job: the row says error, the job completes, nothing parks", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        h.claimed(PAYLOAD)
        t.ai.attempt.mockResolvedValue({ ok: false, failure: "provider" })

        await h.runner.run(t.processor, aiDeliveryOf("agents", GENERATE_JOB.name, PAYLOAD, 1))

        expect(t.em.update).toHaveBeenCalledWith(
            AiGenerationEntity,
            expect.objectContaining({ id: "g1" }),
            expect.objectContaining({ status: "error", error: "no_answer" }),
        )
        expect(h.claims.complete).toHaveBeenCalledTimes(1)
        expect(h.claims.park).not.toHaveBeenCalled()
        expect(h.claims.fail).not.toHaveBeenCalled()
        expect(h.deadLetters.raise).not.toHaveBeenCalled()
    })

    it("a payload its declaration refuses is a dead letter at once (input), never a retry", async () => {
        const t = await build()
        const h = await aiRunnerHarness()
        h.claimed({ other: true })

        await h.runner.run(t.processor, aiDeliveryOf("agents", GENERATE_JOB.name, { other: true }, 1))

        expect(h.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: `payload refused: ${GENERATE_JOB.name}` }))
        expect(h.claims.fail).not.toHaveBeenCalled()
    })
})
