import { Test } from "@nestjs/testing"
import { FakeClock, mock } from "@starci/jest-preset"
import { BrainExtractionsService } from "@modules/domain/brain-extractions"
import { BrainFactsService } from "@modules/domain/brain-facts"
import type { ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import { UsageMeterService } from "@modules/domain/knowledge"
import { KnowledgeChunksService } from "@modules/domain/knowledge-chunks"
import { WorkspaceTimeZoneService } from "@modules/domain/workspace-settings"
import { AI, AiService } from "@modules/integrations/ai"
import { CLOCK, type Clock } from "@modules/platform/clock"
import {
    FencedProcessor,
    JOB_CLAIMS,
    JobDeadLettersService,
    JobRenewalService,
    JobRunnerService,
    JobStateEventsService,
    type ClaimedJob,
    type JobClaims,
} from "@modules/platform/jobs"
import { JOBS_OPTIONS } from "@modules/platform/jobs/jobs.decorators"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { QUEUE_WORKER_REGISTRY, QueueError, QueueErrorCode, type QueueDelivery, type QueueWorkerRegistry } from "@modules/platform/queue"
import { EXTRACT_FACTS_JOB } from "@modules/queues/knowledge"
import { DOC_WS } from "@tests/fixtures/builders/document-facts.builder"
import { STAGES_RULES_DOC, STAGES_STATE, stageRulesOf, stageSource } from "@tests/fixtures/builders/brain-document.builder"
import { CHAIN_JOB_ID, chainProviders } from "@tests/fixtures/builders/knowledge-chain.builder"
import { sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { DocumentNatureService } from "../brain/document-nature.service"
import { DocumentTruthStagesService } from "../brain/document-truth-stages.service"
import { SKIPPED_VERSION } from "../brain/extraction.policy"
import { FactEmbeddingsService } from "../brain/fact-embeddings.service"
import { ModelJsonService } from "../brain/model-json.service"
import type { AiRunner, ChainReply } from "./model-provider.contracts"
import { ModelLiveRunnerService } from "./model-live-runner.service"
import { ModelProviderRegistryService } from "./model-provider-registry.service"
import { ModelRouteService } from "./model-route.service"
import { ModelSandboxRunnerService } from "./model-sandbox-runner.service"
import { MODEL_SANDBOX_CASE, MODEL_SANDBOX_MODEL, type ModelSandboxCaseId } from "./model-sandbox.catalogue"

// AI-SBX, the EXPOSING CASE of the model sandbox: the knowledge FACTS step as the chain is now (`defineJob` frame, the REAL job runner with
// its classifier, ladders and dead letter; the effects ledger keying each model call `<job>:model:<stage>:<part>:<try>`, declared
// `repeatable`), over the REAL model door (`AiService` -> the account route -> the model provider's sandbox runner). The workspace holds a
// sandbox model account and picks a case for the facts step's purpose ONLY (`document_read:extract`, the work scope the step opens).
// The chain reads each case with its own rules, unchanged: MODEL-3 malformed -> asked ONCE more with its own answer, then the window is
// skipped and recorded, the job completes; MODEL-2 refused (no text) -> input: parked at once, ONE dead letter; MODEL-4 timeout ->
// transient: the background ladder, then parked with ONE dead letter. The ledger keeps NO answer of a model call (it is a plain act: the
// key and that it was made), so no sandbox answer is ever kept as a paid one; the meter books it at 0 under `nivo-sandbox`.

const ACCOUNT = { id: "conn-model", workspaceId: DOC_WS, provider: "model", sandbox: true }
const FACTS = "document_read:extract"

/** The real model's answer to a window (the endpoint, MODEL-1): one truth line. */
const REAL_LINE = "1|policy|Shipping inside the city|fee|30.000 VND|-|-|-"

const deliveryOf = (attempt: number): QueueDelivery => ({
    id: "k-1",
    queue: "knowledge",
    job: EXTRACT_FACTS_JOB.name,
    payload: { sourceId: "s1", workspaceId: DOC_WS },
    attempt,
    signal: new AbortController().signal,
})

/** The real job runner over a claims double: the real classifier, the real ladders, the real dead-letter path. */
const runnerOf = async () => {
    const claims = mock<JobClaims>()
    claims.claim.mockResolvedValue({ jobId: CHAIN_JOB_ID, kind: "x", fencingToken: 1, currentStep: null, payload: { sourceId: "s1", workspaceId: DOC_WS } })
    claims.park.mockResolvedValue(true)
    claims.fail.mockResolvedValue(undefined)
    claims.release.mockResolvedValue(undefined)
    claims.complete.mockResolvedValue(undefined)
    claims.retryAfterSeconds.mockResolvedValue(null)
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
    return { runner: moduleRef.get(JobRunnerService), claims, deadLetters }
}

const build = async (caseId: ModelSandboxCaseId) => {
    const { sandbox } = sandboxServiceOf(ACCOUNT)
    await sandbox.setNextCase(ACCOUNT, FACTS, caseId)
    const registry = new ModelProviderRegistryService()
    registry.register({ live: new ModelLiveRunnerService(), sandbox: new ModelSandboxRunnerService(sandbox) })
    const row = mock<ConnectionRecord>({ ...ACCOUNT, status: "connected" } as Partial<ConnectionRecord>)
    const connections = mock<ConnectionsService>({ listByProvider: jest.fn(() => Promise.resolve([row])) })
    const reached = { chat: 0 }
    const real: ChainReply = {
        content: REAL_LINE,
        parsed: null,
        usageMetadata: { input_tokens: 900, output_tokens: 30, total_tokens: 930 },
        responseMetadata: { model_name: "claude-sonnet-5-5", finish_reason: "end_turn", usage: { cost: 0.004 } },
        retrieved: 0,
    }
    const endpoint: AiRunner = {
        chat: () => {
            reached.chat += 1
            return Promise.resolve(real)
        },
        turnModel: () => Promise.reject(new Error("unused")),
        embed: () => Promise.resolve([]),
    }
    const ai = new AiService(
        mock<ConstructorParameters<typeof AiService>[0]>({ chatModel: "work" }),
        endpoint,
        mock<Logger>(),
        mock<Clock>({ now: () => new Date(0) }),
        new ModelRouteService(sandbox, connections, registry),
    )
    const chain = chainProviders()
    const extractions = mock<BrainExtractionsService>()
    const chunks = mock<KnowledgeChunksService>()
    const facts = mock<BrainFactsService>()
    facts.propose.mockImplementation((_ws, input) => Promise.resolve({ created: true, fact: { id: "f1", value: input.value } } as never))
    const usage = mock<UsageMeterService>({ blockedBy: jest.fn(() => Promise.resolve(false)) })
    const vectors = mock<FactEmbeddingsService>({ checkSameMeaning: jest.fn(() => Promise.resolve({ judged: 0, flagged: 0 })) })
    const moduleRef = await Test.createTestingModule({
        providers: [
            ...chain.providers,
            DocumentTruthStagesService,
            ModelJsonService,
            { provide: AI, useValue: ai },
            { provide: LOGGER, useValue: mock<Logger>() },
            { provide: CLOCK, useValue: new FakeClock(new Date("2026-11-14T10:00:00.000Z")) },
            { provide: BrainFactsService, useValue: facts },
            { provide: BrainExtractionsService, useValue: extractions },
            { provide: KnowledgeChunksService, useValue: chunks },
            { provide: UsageMeterService, useValue: usage },
            { provide: FactEmbeddingsService, useValue: vectors },
            {
                provide: DocumentNatureService,
                useValue: mock<DocumentNatureService>({ natureFor: jest.fn(() => Promise.resolve({ kind: "ready" as const, nature: STAGES_RULES_DOC, calls: 0 })) }),
            },
            { provide: WorkspaceTimeZoneService, useValue: mock<WorkspaceTimeZoneService>({ timeZoneOf: () => Promise.resolve("Asia/Ho_Chi_Minh") }) },
        ],
    }).compile()
    const stages = moduleRef.get(DocumentTruthStagesService)
    const failed = jest.fn().mockResolvedValue(undefined)
    /** The facts processor as the feature composes it: one stage of the reading, the dead letter's own failure hook. */
    class FactsProcessor extends FencedProcessor {
        override readonly queue = "knowledge"
        override readonly definition = EXTRACT_FACTS_JOB
        async process(job: ClaimedJob): Promise<void> {
            await stages.extract({ job, source: stageSource, passages: stageRulesOf(4), state: STAGES_STATE })
        }
        override async onFailed(delivery: QueueDelivery): Promise<void> {
            await failed(delivery.payload)
        }
    }
    const h = await runnerOf()
    return { ...h, processor: new FactsProcessor(), sandbox, reached, chain, chunks, extractions, usage, failed }
}

describe("the model sandbox on the knowledge facts step (exposing case, the chain on the job frame)", () => {
    it("MODEL-3 malformed: asked once more with its own answer, the window skipped and recorded, the job completes; billed nothing", async () => {
        const t = await build(MODEL_SANDBOX_CASE.malformed)

        await t.runner.run(t.processor, deliveryOf(1))

        expect(t.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.deadLetters.raise).not.toHaveBeenCalled()
        expect((await t.sandbox.calls(ACCOUNT, FACTS)).map((one) => one.result.outcome)).toEqual(["answered", "answered"])
        expect(t.chunks.markTruthsRead).toHaveBeenCalledWith(DOC_WS, ["c0", "c1", "c2", "c3"], SKIPPED_VERSION)
        expect(t.extractions.note).toHaveBeenCalledWith(DOC_WS, stageSource.id, expect.objectContaining({ skipped: true }))
        // The meter books each sandbox answer at cost 0 under the sandbox's model name, never as a real model's paid answer.
        expect(t.usage.record).toHaveBeenCalledTimes(2)
        for (const [entry] of t.usage.record.mock.calls) {
            expect(entry).toMatchObject({ model: MODEL_SANDBOX_MODEL, usage: { promptTokens: 0, completionTokens: 0, costUsd: 0 } })
        }
        // The effects ledger keyed both calls and keeps NO answer of either (a plain act: no sandbox words stored as a paid answer).
        expect(t.chain.ledger.keys()).toEqual([`${CHAIN_JOB_ID}:model:extract:c0:1`, `${CHAIN_JOB_ID}:model:extract:c0:2`])
        expect(t.chain.ledger.settled()).toEqual([])
        expect(t.reached.chat).toBe(0)
    })

    it("MODEL-2 refused (no text): input, parked AT ONCE with ONE dead letter and the failure hook, no retry spent", async () => {
        const t = await build(MODEL_SANDBOX_CASE.refused)

        await t.runner.run(t.processor, deliveryOf(1))

        expect(t.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "input", reason: "BRAIN_MODEL_REFUSED" }))
        expect(t.deadLetters.raise).toHaveBeenCalledTimes(1)
        expect(t.failed).toHaveBeenCalledTimes(1)
        expect(await t.sandbox.calls(ACCOUNT, FACTS)).toHaveLength(1)
        expect(t.reached.chat).toBe(0)
    })

    it("MODEL-4 timeout: transient, the background ladder, then parked with ONE dead letter; every run asked again (never hidden)", async () => {
        const t = await build(MODEL_SANDBOX_CASE.timedOut)

        const thrown: Array<unknown> = []
        let attempt = 0
        while (t.claims.park.mock.calls.length === 0 && attempt < 10) {
            attempt += 1
            thrown.push(await t.runner.run(t.processor, deliveryOf(attempt)).then(() => null, (cause: unknown) => cause))
        }

        expect(t.claims.park).toHaveBeenCalledTimes(1)
        expect(t.claims.park).toHaveBeenCalledWith(expect.objectContaining({ failureClass: "transient" }))
        expect(t.deadLetters.raise).toHaveBeenCalledTimes(1)
        const retries = thrown.slice(0, -1)
        expect(retries.length).toBeGreaterThan(0)
        for (const one of retries) expect(one).toMatchObject({ code: QueueErrorCode.RetryAfter })
        expect(retries.every((one) => one instanceof QueueError)).toBe(true)
        // One model call per run, each THROWN by the sandbox and re-asked on the next run (the key is `repeatable`: acted again).
        const calls = await t.sandbox.calls(ACCOUNT, FACTS)
        expect(calls).toHaveLength(attempt)
        expect(calls.every((one) => one.result.outcome === "threw" && one.result.error === "TimeoutError")).toBe(true)
        expect(t.chain.ledger.rows.get(`${CHAIN_JOB_ID}:model:extract:c0:1`)?.acts).toBe(attempt)
        expect(t.chain.ledger.settled()).toEqual([])
        expect(t.reached.chat).toBe(0)
    })

    it("MODEL-4 then back to MODEL-1: the next run asks the REAL model under the same key (a fault is never replayed or kept)", async () => {
        const t = await build(MODEL_SANDBOX_CASE.timedOut)
        await expect(t.runner.run(t.processor, deliveryOf(1))).rejects.toMatchObject({ code: QueueErrorCode.RetryAfter })

        await t.sandbox.setNextCase(ACCOUNT, FACTS, MODEL_SANDBOX_CASE.passed)
        await t.runner.run(t.processor, deliveryOf(2))

        // The real model answered the window (and, as its line leaves passages unaccounted, the step's own follow-up).
        expect(t.reached.chat).toBeGreaterThanOrEqual(1)
        expect(t.claims.complete).toHaveBeenCalledTimes(1)
        expect(t.chain.ledger.rows.get(`${CHAIN_JOB_ID}:model:extract:c0:1`)?.acts).toBe(2)
        expect(t.usage.record).toHaveBeenLastCalledWith(expect.objectContaining({ model: "claude-sonnet-5-5" }))
    })
})
