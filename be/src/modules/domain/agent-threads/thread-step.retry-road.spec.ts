import { Test } from "@nestjs/testing"
import { FakeClock, mock } from "@starci/jest-preset"
import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import type { NodeHostPorts } from "@nivo-lite/agent-sdk/node"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { AgentGraphAiCoreService, AgentGraphsService } from "@modules/domain/agent-graphs"
import { GraphNodeHostService, GraphNodeRegistryService } from "@modules/domain/graph-nodes"
import type { NodeRunInput } from "@modules/domain/graph-nodes"
import type { ThreadNodeScope, ThreadState } from "@modules/integrations/langgraph"
import { CLOCK } from "@modules/platform/clock"
import { DomainError } from "@modules/platform/errors"
import { MESSAGE_CATALOG } from "@modules/platform/i18n"
import type { MessageCatalog } from "@modules/platform/i18n"
import { RunStopRecordsService } from "./stops/run-stop-records.service"
import type { StopBuild } from "./stops/run-stop-records.service"
import type { RunStop, StopOpen } from "./stops/run-stop.contracts"
import { RunStopsService } from "./stops/run-stops.service"
import { StopCardsService } from "./stops/stop-cards.service"
import { FREEZE_NODE, type CompiledStep } from "./template-compiler.policy"
import { ThreadStepService, type ThreadStepNode } from "./thread-step.service"

// ENGINE-FIN (c), second kind: ONE road for every retry of an act whose outcome is unknown (the engine's ladder rung, a person's Retry, a
// deadline's timeout): the visit continues the attempt (`host.remake` = the recorded intent under its key, then `modelReplay` = the
// recorded model turns), whoever sent the thread back. A run about NO person (a transaction subject), a repeatable act that is no customer
// send (the payment request). The chat-shaped case is the world `tests/engine-threads/send-outcome-unknown.spec.ts`.

const NOW = "2026-11-10T10:00:00.000Z"
const REF = { workspaceId: "ws-1", runId: "run-1" }

class OtherError extends DomainError<string> {}

const FLOW: GraphSpec = {
    schema: "nivo/agent-graph@1",
    moduleKey: "accounting",
    trigger: { kind: "tag", sources: [] },
    grant: { tools: [], effects: [] },
    nodes: [
        { key: "ask", kind: "execute", step: "accounting.ask-payment", next: "settle" },
        { key: "settle", kind: "execute", step: "payment.settle" },
    ],
}

const STEP: CompiledStep = { key: "ask", step: "accounting.ask-payment", kind: "execute", exit: { kind: "next", to: "settle" }, ends: ["settle", FREEZE_NODE] }

const AT: ThreadStepNode = {
    agentId: "agent-1",
    versionId: "v-1",
    flow: FLOW,
    step: STEP,
    namespace: "accounting.collect",
    workflowId: "wf-1",
    replay: (ports: NodeHostPorts): NodeHostPorts => ports,
}

const stateOf = (over: Partial<ThreadState> = {}): ThreadState => ({
    trigger: { transactionId: "tx-1", subject: { kind: "bank-transaction", id: "tx-1" }, locale: "vi" },
    steps: {},
    trouble: null,
    founderAnswers: [],
    loop: null,
    ...over,
})

const scopeOf = (decision?: unknown): ThreadNodeScope => ({
    thread: REF,
    node: "ask",
    version: "v-1",
    stop: jest.fn(() => {
        if (decision === undefined) throw new Error("interrupted")
        return decision
    }) as ThreadNodeScope["stop"],
})

/** The unknown outcome of the payment request (repeatable by its spec): the call left, no answer came back. */
const unknownRequest = (): OtherError => new OtherError({ code: "tool_outcome_unknown", params: { effect: TOOL.paymentRequestCreate } })

const build = async () => {
    let stop: RunStop | null = null
    const records = mock<RunStopRecordsService>({
        open: jest.fn((input: StopOpen) => {
            stop = {
                id: "stop-1",
                version: "1",
                runId: input.runId,
                stepKey: input.stepKey,
                agentId: input.agentId,
                workflowId: input.workflowId,
                contactId: input.contactId,
                conversationId: input.conversationId,
                kind: input.kind,
                state: "open",
                reason: input.reason,
                question: input.question,
                detail: { suggestions: [...input.suggestions], facts: [...input.facts] },
                cardMessageId: null,
                customerLines: [],
                answers: stop?.answers ?? [],
                decision: null,
                repeats: (stop?.repeats ?? 0) + 1,
                stoppedAt: NOW,
                resolvedAt: null,
            }
            return Promise.resolve(stop)
        }),
        byRunStep: jest.fn(() => Promise.resolve(stop)),
        patch: jest.fn((_ws: string, _id: string, change: StopBuild) => {
            if (stop === null) return Promise.resolve(null)
            const values = change(stop)
            if (values === null) return Promise.resolve(null)
            stop = { ...stop, ...values }
            return Promise.resolve(stop)
        }),
    })
    const graphs = mock<AgentGraphsService>({
        runGrantOf: jest.fn().mockResolvedValue({ tools: [], effects: null }),
        workflowVersionIdOf: jest.fn((_w: string, _a: string, versionId: string) => Promise.resolve(versionId)),
    })
    const host = mock<GraphNodeHostService>()
    host.remake.mockResolvedValue(1)
    const nodes = mock<GraphNodeRegistryService>({
        installed: jest.fn(() => ({ nodes: new Map([["accounting.ask-payment", { effects: [], title: { vi: "Hoi tien", en: "Ask" } }]]) }) as never),
        optionalExecutorOf: jest.fn(() => undefined),
    })
    const core = mock<AgentGraphAiCoreService>()
    core.decide.mockResolvedValue({ kind: "report", reason: "unknown", question: null, suggestions: [], customerLine: null })
    const cards = mock<StopCardsService>({ posted: jest.fn().mockResolvedValue("msg-1"), resolved: jest.fn().mockResolvedValue(undefined) })
    const moduleRef = await Test.createTestingModule({
        providers: [
            ThreadStepService,
            RunStopsService,
            { provide: RunStopRecordsService, useValue: records },
            { provide: StopCardsService, useValue: cards },
            { provide: AgentGraphsService, useValue: graphs },
            { provide: GraphNodeHostService, useValue: host },
            { provide: GraphNodeRegistryService, useValue: nodes },
            { provide: AgentGraphAiCoreService, useValue: core },
            { provide: CLOCK, useValue: new FakeClock(NOW) },
            { provide: MESSAGE_CATALOG, useValue: mock<MessageCatalog>({ get: jest.fn((key: string) => `[${key}]`) }) },
        ],
    }).compile()
    return { steps: moduleRef.get(ThreadStepService), host, core, stopOf: () => stop }
}

const inputOf = (host: ReturnType<typeof mock<GraphNodeHostService>>, call: number): NodeRunInput | undefined => host.run.mock.calls[call]?.[0]

/** The step's act ended unknown on its LAST rung (four retries made): the ladder gives up and the step stops for a person. */
const exhausted = async (built: Awaited<ReturnType<typeof build>>): Promise<ThreadState> => {
    built.host.remake.mockRejectedValueOnce(unknownRequest())
    const lastRung = stateOf({ trouble: { stepKey: "ask", locale: "vi", retry: { attempt: 4, dueAt: NOW, code: "tool_outcome_unknown" } } })
    const answer = await built.steps.run(AT, lastRung, scopeOf())
    expect(answer.goto).toBe(FREEZE_NODE)
    return stateOf({ trouble: answer.update?.trouble })
}

describe("ENGINE-FIN (c): an exhausted ladder is the outcome-unknown stop, and every retry continues the attempt", () => {
    it("the last rung still unknown: ONE stop that keeps the act's code, states the retries, and offers Retry (the tool is repeatable)", async () => {
        const built = await build()
        const state = await exhausted(built)

        expect(state.trouble).toMatchObject({ stepKey: "ask", code: "tool_outcome_unknown" })
        const facts = Object.fromEntries((built.stopOf()?.detail.facts ?? []).map((fact) => [fact.name, fact.value]))
        expect(facts).toMatchObject({ code: "tool_outcome_unknown", effect: TOOL.paymentRequestCreate, retries: "4" })
        expect(facts.retry).toBeUndefined()
        // The rung made the recorded act again and asked no model.
        expect(built.host.remake).toHaveBeenCalledTimes(1)
        expect(built.host.run).not.toHaveBeenCalled()
    })

    it("a person's Retry continues the attempt: the recorded act made again, the recorded model turns replayed (no fresh wording)", async () => {
        const built = await build()
        const state = await exhausted(built)

        const routed = await built.steps.gate({ agentId: "agent-1" }, state, scopeOf({ kind: "retry", by: "owner-1", at: "t" }))
        expect(routed).toEqual({ update: { founderAnswers: [], trouble: { stepKey: "ask", decidedRetry: "tool_outcome_unknown" } }, goto: "ask" })

        built.host.run.mockResolvedValue({ output: { requestRef: "r-1" }, effects: [] })
        await expect(built.steps.run(AT, stateOf({ trouble: routed.update?.trouble }), scopeOf())).resolves.toMatchObject({ goto: "settle" })
        expect(built.host.remake).toHaveBeenCalledTimes(2)
        expect(inputOf(built.host, 0)).toMatchObject({ key: "run-1:ask", modelReplay: true })
    })

    it("a deadline's timeout is the same road (no words): the attempt continues", async () => {
        const built = await build()
        const state = await exhausted(built)

        const routed = await built.steps.gate({ agentId: "agent-1" }, state, scopeOf({ kind: "timeout", at: "t" }))
        expect(routed.update?.trouble).toEqual({ stepKey: "ask", decidedRetry: "tool_outcome_unknown" })
    })

    it("a person's WORDS are a new instruction: no continuation marker, the model reads them (the act at that position stays answered by its receipt)", async () => {
        const built = await build()
        const state = await exhausted(built)

        const words = { kind: "answer", text: "Hoi lai so tien", by: "owner-1", at: "2026-11-10T10:05:00.000Z" }
        const routed = await built.steps.gate({ agentId: "agent-1" }, state, scopeOf(words))
        expect(routed.update?.trouble).toBeNull()

        built.host.run.mockResolvedValue({ output: { requestRef: "r-1" }, effects: [] })
        await built.steps.run(AT, stateOf({ founderAnswers: routed.update?.founderAnswers ?? [] }), scopeOf())
        expect(built.host.remake).toHaveBeenCalledTimes(1)
        expect(inputOf(built.host, 0)?.modelReplay).toBeUndefined()
    })
})
