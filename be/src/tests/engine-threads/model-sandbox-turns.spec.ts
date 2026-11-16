import { AIMessageChunk } from "@langchain/core/messages"
import { mock } from "@starci/jest-preset"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { AiTasksService } from "@modules/domain/ai-tasks"
import { AiUsageEventsService, UsageGateService } from "@modules/domain/ai-usage-events"
import type { ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import {
    MODEL_SANDBOX_CASE,
    MODEL_SANDBOX_MODEL,
    ModelProviderRegistryService,
    ModelRouteService,
    ModelSandboxRunnerService,
    type ModelSandboxCaseId,
} from "@modules/domain/model-provider"
import { ModelLiveRunnerService } from "../../modules/domain/model-provider/model-live-runner.service"
import type { AiChatModel, AiRunner, ChainReply } from "../../modules/domain/model-provider/model-provider.contracts"
import { AiService } from "@modules/integrations/ai"
import type { Clock } from "@modules/platform/clock"
import type { MessageCatalog } from "@modules/platform/i18n"
import type { Logger } from "@modules/platform/logging"
import type { Timer } from "@modules/platform/retry"
import type { EntityManager } from "typeorm"
import { sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { ANSWER, ANSWER_NODE, AGENT_FIRST_TRY_MS, AGENT_RETRY_MS, CORE, UNDERSTAND, WS, actsOf, customerWrites, processOf, stopsOf, threadDbOf } from "./thread-world"
import { coreReport } from "./thread-world-w8-wakes"

// The world's desk installed beside the core: an agent step that acts itself, on the template road (`thread-desk-plugin.builder.ts`).
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const desk: typeof import("@tests/fixtures/builders/thread-desk-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/thread-desk-plugin.builder",
    )
    return { installed: parts.installationWith([desk.DESK_PLUGIN], "world-desk") }
})

// AI-SBX, the SECOND KIND of the model sandbox (R75): a graph node's agent turn on the prebuilt loop (`AGENT_LOOP=prebuilt:<answer>`) over
// the REAL model door (`AiTasksService` -> `AiService` -> the account route -> the model provider's sandbox runner). The workspace holds a
// sandbox model account; the case is picked for the ANSWER step's purpose ONLY, so the understand step of the same run (another purpose)
// passes to the endpoint and runs as on a real model. MODEL-4 (timeout): three tries of the turn, then ONE engine-written `ai_error`
// stop; MODEL-7 ("cannot" in the node's protocol): the turn's `confused` tool call ends the step as the AI's confusion. Nothing reaches the
// customer either way.

const MODEL_ACCOUNT = { id: "conn-model", workspaceId: WS, provider: "model", sandbox: true }

/** What the real model answers per purpose (the endpoint): the understand step's turn, and the AI core's report of a step that stopped. */
const ENDPOINT_ANSWERS: Readonly<Record<string, unknown>> = {
    [UNDERSTAND]: { done: { branch: "question", summary: "Lan: gio mo cua" } },
    [CORE]: coreReport("Shop mo may gio?"),
}

/** The endpoint (the live account): answers the purposes above; any agent-turn try that reaches it fails the spec. */
const endpointOf = () => {
    const reached = { chat: 0, turn: 0, purposes: new Array<string>() }
    const replyOf = (purpose: string): ChainReply => ({
        content: JSON.stringify(ENDPOINT_ANSWERS[purpose] ?? {}),
        parsed: null,
        usageMetadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        responseMetadata: { model_name: "claude-sonnet-5-5", finish_reason: "end_turn" },
        retrieved: 0,
    })
    const client: AiChatModel = mock<AiChatModel>({
        bindTools: jest.fn(() => client),
        invoke: jest.fn(() => {
            reached.turn += 1
            return Promise.resolve(new AIMessageChunk({ content: "the endpoint must not answer this turn" }))
        }),
    })
    const endpoint: AiRunner = {
        chat: (request) => {
            reached.chat += 1
            reached.purposes.push(request.purpose ?? "")
            return Promise.resolve(replyOf(request.purpose ?? ""))
        },
        turnModel: () => Promise.resolve(client),
        embed: () => Promise.resolve([]),
    }
    return { endpoint, reached }
}

/**
 * THE REAL METER PATH: the usage gate over the one writer of `ai_usage_events` (pricing, estimates, the failed-try rule); only the row
 * insert is caught here. The month's level cannot be read (no query double): the meter fails open, as it does when that read fails.
 */
const realMeterOf = () => {
    const rows = new Array<Readonly<Record<string, unknown>>>()
    const entityManager = mock<EntityManager>({
        insert: jest.fn((_entity: unknown, row: Readonly<Record<string, unknown>>) => {
            rows.push(row)
            return Promise.resolve({ identifiers: [], generatedMaps: [], raw: [] })
        }),
    })
    const catalog = mock<MessageCatalog>({ get: () => "" })
    const events = new AiUsageEventsService(entityManager, mock<Logger>(), catalog)
    jest.spyOn(events, "blockedBy").mockResolvedValue(null)
    return { gate: new UsageGateService(events, catalog), rows }
}

/** The REAL model door over the account route, with the workspace's sandbox model account picked `caseId` for the ANSWER purpose. */
const doorWith = async (caseId: ModelSandboxCaseId, metered?: ReturnType<typeof realMeterOf>) => {
    const { sandbox } = sandboxServiceOf(MODEL_ACCOUNT)
    await sandbox.setNextCase(MODEL_ACCOUNT, ANSWER, caseId)
    const registry = new ModelProviderRegistryService()
    registry.register({ live: new ModelLiveRunnerService(), sandbox: new ModelSandboxRunnerService(sandbox) })
    const row = mock<ConnectionRecord>({ ...MODEL_ACCOUNT, status: "connected" } as Partial<ConnectionRecord>)
    const connections = mock<ConnectionsService>({ listByProvider: jest.fn(() => Promise.resolve([row])) })
    const route = new ModelRouteService(sandbox, connections, registry)
    const { endpoint, reached } = endpointOf()
    const ai = new AiService(
        mock<ConstructorParameters<typeof AiService>[0]>({ chatModel: "work" }),
        endpoint,
        mock<Logger>(),
        mock<Clock>({ now: () => new Date(0) }),
        route,
    )
    const timer = mock<Timer>({
        schedule: (callback: () => void) => {
            callback()
            return () => undefined
        },
    })
    const meter: ConstructorParameters<typeof AiTasksService>[2] =
        metered?.gate ?? mock<ConstructorParameters<typeof AiTasksService>[2]>({ blockedBy: () => Promise.resolve(null), record: jest.fn(() => Promise.resolve()) })
    const tasks = new AiTasksService(
        { timeoutMs: 30_000, nodeTimeoutMs: AGENT_FIRST_TRY_MS, nodeRetryTimeoutMs: AGENT_RETRY_MS, endpoint: mock(), providers: { anthropic: true, openrouter: false } },
        ai,
        meter,
        mock<Logger>(),
        timer,
        mock(),
        mock(),
    )
    return { door: tasks, sandbox, reached, meter: meter as jest.Mocked<ConstructorParameters<typeof AiTasksService>[2]> }
}

describe("the model sandbox on a graph node's agent turn (second kind)", () => {
    it("MODEL-4 for the answer step only: three timed-out tries, ONE ai_error stop; the understand step passed to the endpoint", async () => {
        const db = threadDbOf()
        const model = await doorWith(MODEL_SANDBOX_CASE.timedOut)
        const process = await processOf(db, { model: model.door, agentLoop: [ANSWER_NODE] })

        const runId = (await customerWrites(process, "Shop mo cua may gio?")).runId ?? ""

        const stops = await stopsOf(process, runId)
        expect(stops.map((stop) => [stop.stepKey, stop.kind, stop.state])).toEqual([["answer", "ai_error", "open"]])
        expect(stops[0]?.detail.facts).toEqual(
            expect.arrayContaining([
                { name: "tries", value: "3" },
                { name: "failures", value: "timeout, timeout, timeout" },
            ]),
        )
        expect((await model.sandbox.calls(MODEL_ACCOUNT, ANSWER)).map((one) => one.result)).toEqual([
            { outcome: "threw", error: "TimeoutError" },
            { outcome: "threw", error: "TimeoutError" },
            { outcome: "threw", error: "TimeoutError" },
        ])
        expect((await model.sandbox.calls(MODEL_ACCOUNT, UNDERSTAND)).map((one) => one.result.outcome)).toEqual(["answered"])
        expect(model.reached).toEqual({ chat: 1, turn: 0, purposes: [UNDERSTAND] })
        expect(actsOf(db, TOOL.customerMessageSend)).toEqual([])
        expect((await process.threads.stateOf({ workspaceId: WS, runId }))?.status).toBe("stopped")
    })

    it("MODEL-4 on the REAL meter path: the faulted tries left no request and book NOTHING; the pass-through is booked as a real call", async () => {
        const db = threadDbOf()
        const metered = realMeterOf()
        const model = await doorWith(MODEL_SANDBOX_CASE.timedOut, metered)
        const process = await processOf(db, { model: model.door, agentLoop: [ANSWER_NODE] })

        await customerWrites(process, "Shop mo cua may gio?")

        // Three faulted tries of the answer step, none of which reached the endpoint (no outside request left).
        expect(await model.sandbox.calls(MODEL_ACCOUNT, ANSWER)).toHaveLength(3)
        expect(model.reached).toEqual({ chat: 1, turn: 0, purposes: [UNDERSTAND] })
        // The meter holds exactly the pass-through (MODEL-1 for the understand step): the real model, its reported tokens, priced
        // (2 USD / 10 USD per million: 10 in + 5 out), not estimated, no failure. No row for a faulted try, estimated or not.
        expect(metered.rows).toEqual([
            expect.objectContaining({
                model: "claude-sonnet-5-5",
                promptTokens: 10,
                completionTokens: 5,
                costUsd: "0.00007",
                estimated: false,
                purpose: UNDERSTAND,
                failure: null,
            }),
        ])
    })

    it("MODEL-7: the turn says `confused` in the loop's own protocol: the step ends as the AI's confusion, nothing sent", async () => {
        const db = threadDbOf()
        const model = await doorWith(MODEL_SANDBOX_CASE.confused)
        const process = await processOf(db, { model: model.door, agentLoop: [ANSWER_NODE] })

        const runId = (await customerWrites(process, "Shop mo cua may gio?")).runId ?? ""

        const stops = await stopsOf(process, runId)
        expect(stops).toHaveLength(1)
        expect(stops[0]?.stepKey).toBe("answer")
        // The confusion goes to the AI core (another purpose: passed to the endpoint), whose report is the stop.
        expect(stops[0]?.kind).toBe("ai_report")
        expect(await model.sandbox.calls(MODEL_ACCOUNT, ANSWER)).toHaveLength(1)
        expect(model.reached.purposes).toEqual([UNDERSTAND, CORE])
        // The sandbox's answered turn is metered at cost 0 under `nivo-sandbox`, the real answers under the real model.
        const booked = model.meter.record.mock.calls.map(([entry]) => entry)
        expect(booked.filter((entry) => entry.usage?.model === MODEL_SANDBOX_MODEL)).toEqual([
            expect.objectContaining({ usage: expect.objectContaining({ cost: 0, prompt_tokens: 0, completion_tokens: 0 }), call: expect.objectContaining({ purpose: ANSWER }) }),
        ])
        expect(actsOf(db, TOOL.customerMessageSend)).toEqual([])
    })
})
