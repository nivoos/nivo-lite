import { mock } from "@starci/jest-preset"
import type { AgentRunsService } from "@modules/domain/agent-runs"
import type { GraphThreads } from "@modules/integrations/langgraph"
import type { RunStop } from "./stops/run-stop.contracts"
import type { RunStopsService } from "./stops/run-stops.service"
import type { ThreadDeadlinesService } from "./thread-deadlines.service"
import { ThreadParkedDeadlinesService } from "./thread-parked-deadlines.service"

// ENGINE-FIN (b): one door over every parked deadline of a thread (the dev time levers). The worlds are `deadline-levers.spec.ts`
// (a retry rung, an approval's expiry) and `sandbox-expire-wait.spec.ts` (a wait's timeout).

const WAIT_QUESTION = {
    kind: "wait",
    parkKey: "pay[r1].hold",
    dueAt: "2026-11-15T08:00:00.000Z",
    on: [{ key: "credit", verb: "payment.credit.received" }],
    subject: { conversationId: "conv-1" },
}
const RETRY_QUESTION = { kind: "until_round", loopKey: "retry:answer", round: 2, dueAt: "2026-11-15T08:02:00.000Z", parkKey: "retry:answer[r2]" }
const ROUND_QUESTION = { kind: "until_round", loopKey: "nudge", round: 3, dueAt: "2026-11-16T08:00:00.000Z", parkKey: "nudge[r3]" }
const STOP_QUESTION = { stopId: "s-1", runId: "r4", stepKey: "answer", kind: "approval", reason: "", question: null }
const ENGINE_QUESTION = { stopId: "s-2", runId: "r5", stepKey: "answer", kind: "engine", reason: "", question: null }

const stopOf = (kind: RunStop["kind"]): RunStop =>
    ({ id: "s", runId: "r", stepKey: "answer", kind, state: "open", repeats: 1, answers: [], stoppedAt: "2026-11-15T07:00:00.000Z" }) as unknown as RunStop

const setup = (questions: Readonly<Record<string, unknown>>) => {
    const runs = mock<AgentRunsService>()
    runs.inFlightThreads.mockImplementation((_ws, limit) =>
        Promise.resolve(["r1", "r2", "r3", "r4", "r5", "r6"].slice(0, limit).map((id) => ({ id, agentId: "agent-1", context: {} })) as never),
    )
    const deadlines = mock<ThreadDeadlinesService>()
    deadlines.fireNow.mockResolvedValue("admitted")
    deadlines.dueOf.mockImplementation((ref, stop) =>
        Promise.resolve(
            stop.kind === "engine"
                ? null
                : { at: new Date("2026-11-16T07:00:00.000Z"), payload: { ...ref, stepKey: stop.stepKey, repeats: 1, answered: 0 } },
        ),
    )
    const stops = mock<RunStopsService>()
    stops.stopOf.mockImplementation((ref) => Promise.resolve(stopOf(ref.runId === "r5" ? "engine" : "approval")))
    const threads = mock<GraphThreads>()
    threads.stateOf.mockImplementation((ref) =>
        Promise.resolve(
            ref.runId in questions ? ({ status: "stopped", stop: { question: questions[ref.runId] } } as never) : ({ status: "running" } as never),
        ),
    )
    return { runs, deadlines, service: new ThreadParkedDeadlinesService(runs, deadlines, stops, threads) }
}

describe("ThreadParkedDeadlinesService: every parked deadline of a thread, fired now through the one deadline road", () => {
    it("lists a wait, a retry rung, an until round and an approval's expiry by kind; an engine stop (no deadline) and a running run are left out", async () => {
        const { service } = setup({ r1: WAIT_QUESTION, r2: RETRY_QUESTION, r3: ROUND_QUESTION, r4: STOP_QUESTION, r5: ENGINE_QUESTION })

        const parked = await service.parked("ws-1", 10)

        expect(parked.map((one) => [one.runId, one.kind, one.parkKey, one.dueAt, one.waitsFor.length])).toEqual([
            ["r1", "wait", "pay[r1].hold", "2026-11-15T08:00:00.000Z", 1],
            ["r2", "retry", "retry:answer[r2]", "2026-11-15T08:02:00.000Z", 0],
            ["r3", "round", "nudge[r3]", "2026-11-16T08:00:00.000Z", 0],
            ["r4", "approval", "answer", "2026-11-16T07:00:00.000Z", 0],
        ])
    })

    it("is bounded: at most 50 runs are read whatever is asked", async () => {
        const { service, runs } = setup({})
        await service.parked("ws-1", 500)
        expect(runs.inFlightThreads).toHaveBeenCalledWith("ws-1", 50)
    })

    it("fires each kind with its own deadline payload through `fireNow`; a run parked on nothing answers `closed`", async () => {
        const { service, deadlines } = setup({ r1: WAIT_QUESTION, r2: RETRY_QUESTION, r4: STOP_QUESTION, r5: ENGINE_QUESTION })

        await expect(service.fireNow("ws-1", "r1")).resolves.toBe("admitted")
        await expect(service.fireNow("ws-1", "r2")).resolves.toBe("admitted")
        await expect(service.fireNow("ws-1", "r4")).resolves.toBe("admitted")
        await expect(service.fireNow("ws-1", "r5")).resolves.toBe("closed")
        await expect(service.fireNow("ws-1", "r6")).resolves.toBe("closed")
        expect(deadlines.fireNow.mock.calls.map(([payload]) => payload)).toEqual([
            { workspaceId: "ws-1", runId: "r1", stepKey: "pay[r1].hold", repeats: 0, answered: -2 },
            { workspaceId: "ws-1", runId: "r2", stepKey: "retry:answer[r2]", repeats: 2, answered: -1 },
            { workspaceId: "ws-1", runId: "r4", stepKey: "answer", repeats: 1, answered: 0 },
        ])
    })
})
