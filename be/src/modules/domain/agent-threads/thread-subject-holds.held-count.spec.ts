import { mock, mockEntityManager } from "@starci/jest-preset"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import type { AgentRunsService } from "@modules/domain/agent-runs"
import type { AgentWakeContext } from "@modules/domain/agent-work"
import type { GraphNodeRegistryService, NodeEffectExecutor } from "@modules/domain/graph-nodes"
import type { DeliveredWakesService } from "@modules/domain/provider-triggers/delivered-wakes.service"
import type { GraphThreads } from "@modules/integrations/langgraph"
import type { Clock } from "@modules/platform/clock"
import type { MessageCatalog } from "@modules/platform/i18n"
import type { Logger } from "@modules/platform/logging"
import type { RunStopRecordsService, StopBuild } from "./stops/run-stop-records.service"
import type { RunStop } from "./stops/run-stop.contracts"
import { RunStopsService } from "./stops/run-stops.service"
import { StopCardsService } from "./stops/stop-cards.service"
import { ThreadSubjectHoldsService } from "./thread-subject-holds.service"

// ENGINE-FIN (a): a person deciding a stop sees how much of the subject's work waits behind it, whatever its source. When an event is
// held behind a run that has an OPEN stop, that stop's ONE card is rewritten in place with the number of events waiting (`waiting`): a
// stream marker counts its events, an `each` wake one, a `latest` wake one. Real: the holds' count, the stops' fact, the card's rewrite
// (its payload and its once-key). Doubles: the stop record store, the held wakes (`waiting:<run>`), the team chat's post executor.
// Case (chat-shaped): a person's lines as a stream marker of 3, then a 4th line held. Second kind (no person, record write events): `each`.

const WS = "ws-1"
const RUN = "run-1"

const openStop = (over: Partial<RunStop> = {}): RunStop => ({
    id: "stop-1",
    version: "1",
    runId: RUN,
    stepKey: "answer",
    agentId: "agent-1",
    workflowId: "wf-1",
    contactId: null,
    conversationId: null,
    kind: "ai_report",
    state: "open",
    reason: "stuck",
    question: null,
    detail: { suggestions: [], facts: [{ name: "code", value: "delivery_outcome_unknown" }] },
    cardMessageId: "msg-1",
    customerLines: [],
    answers: [],
    decision: null,
    repeats: 1,
    stoppedAt: "2026-11-10T10:00:00.000Z",
    resolvedAt: null,
    ...over,
})

const worldOf = (first: RunStop | null, held: ReadonlyArray<AgentWakeContext>) => {
    let stop = first
    const records = mock<RunStopRecordsService>({
        ofRun: jest.fn(() => Promise.resolve(stop === null ? [] : [stop])),
        byRunStep: jest.fn(() => Promise.resolve(stop)),
        patch: jest.fn((_ws: string, _id: string, change: StopBuild) => {
            if (stop === null) return Promise.resolve(null)
            const values = change(stop)
            if (values === null) return Promise.resolve(null)
            stop = { ...stop, ...values }
            return Promise.resolve(stop)
        }),
    })
    const post = mock<NodeEffectExecutor>({ effect: TOOL.teamMessagePost })
    post.execute.mockResolvedValue({ kind: "chat-message", id: "msg-1" })
    const nodes = mock<GraphNodeRegistryService>({ optionalExecutorOf: jest.fn(() => post) })
    const cards = new StopCardsService(mock<MessageCatalog>({ get: jest.fn((key: string) => `[${key}]`) }), nodes)
    const stops = new RunStopsService(mock<Clock>({ now: () => new Date("2026-11-10T10:05:00.000Z") }), records, cards)
    const kept = [...held]
    const wakes = mock<DeliveredWakesService>({
        heldBehind: jest.fn(() => Promise.resolve(kept.map((context, at) => ({ id: `w-${String(at)}`, context, createdAt: new Date(at) })))),
        runsHeldBehind: jest.fn(() => Promise.resolve([RUN])),
    })
    const threads = mock<GraphThreads>({ stateOf: jest.fn().mockResolvedValue({ state: { trigger: { locale: "en" } } }) })
    const holds = new ThreadSubjectHoldsService(
        mockEntityManager(),
        mock<Logger>(),
        records,
        // The run is still in flight (stopped for a person): the sweep releases nothing and brings the count up to date.
        mock<AgentRunsService>({ runOf: jest.fn().mockResolvedValue({ status: "waiting" }) }),
        wakes,
        undefined,
        undefined,
        undefined,
        stops,
        threads,
    )
    /** The rewrites the card got: their once-key and the live facts each carried. */
    const rewrites = () =>
        post.execute.mock.calls.map(([, payload, call]) => ({
            key: call.key,
            live: Reflect.get(Reflect.get(payload, "rewrite") as object, "liveFacts") as unknown,
        }))
    return { holds, kept, rewrites, current: () => stop }
}

const line = (count?: number): AgentWakeContext => ({ combine: "stream", ...(count === undefined ? {} : { count: String(count) }) }) as AgentWakeContext
const recordEvent = (): AgentWakeContext => ({ combine: "each" }) as AgentWakeContext
const latest = (count: number): AgentWakeContext => ({ combine: "latest", count: String(count) }) as AgentWakeContext

describe("ENGINE-FIN (a): the stop card says how many events of its subject wait behind the run", () => {
    it("CASE (a person's lines): a stream marker of 3 held and a 4th line being held: the ONE card is rewritten in place with 4, then 5", async () => {
        const world = worldOf(openStop(), [line(3)])

        await world.holds.eventHeld(WS, RUN, line())
        expect(world.current()?.detail.facts).toContainEqual({ name: "waiting", value: "4" })
        // The flow's hold of the 4th line: it is the wake being held now (not yet written), counted with the marker of 3 (= 4 events).
        world.kept.push(line())
        await world.holds.eventHeld(WS, RUN, line())
        expect(world.current()?.detail.facts).toContainEqual({ name: "waiting", value: "5" })

        const rewrites = world.rewrites()
        expect(rewrites).toHaveLength(2)
        expect(rewrites.map((one) => one.live)).toEqual([[{ name: "waiting", value: "4" }], [{ name: "waiting", value: "5" }]])
        // One card: every rewrite folds into the same message (dedupe key = the stop's card key); each number is its own write.
        expect(new Set(rewrites.map((one) => one.key)).size).toBe(2)
        expect(rewrites.every((one) => String(one.key).startsWith(`run-stuck:${RUN}:answer:open:`))).toBe(true)
    })

    it("SECOND KIND (record write events, no person): `each` events held one by one count one each; a `latest` wake counts one", async () => {
        const world = worldOf(openStop({ stepKey: "settle" }), [recordEvent()])

        await world.holds.eventHeld(WS, RUN, recordEvent())
        expect(world.current()?.detail.facts).toContainEqual({ name: "waiting", value: "2" })

        world.kept.push(recordEvent())
        await world.holds.eventHeld(WS, RUN, latest(7))
        expect(world.current()?.detail.facts).toContainEqual({ name: "waiting", value: "3" })
    })

    it("the sweep brings a folded stream marker up to date; the same number again writes nothing (no notification spam)", async () => {
        const world = worldOf(openStop(), [line(2)])
        await world.holds.eventHeld(WS, RUN, line())
        expect(world.rewrites()).toHaveLength(1)

        // A 4th and 5th line folded into the held marker (they begin no wake): the marker now stands for 5 with the line held above.
        world.kept.splice(0, world.kept.length, line(4), line())
        await world.holds.swept(WS)
        await world.holds.swept(WS)
        expect(world.current()?.detail.facts).toContainEqual({ name: "waiting", value: "5" })
        expect(world.rewrites()).toHaveLength(2)
    })

    it("a run with no open stop is told nothing: no fact, no card", async () => {
        const world = worldOf(openStop({ state: "resolved" }), [line(3)])
        await world.holds.eventHeld(WS, RUN, line())
        expect(world.rewrites()).toEqual([])
        expect(world.current()?.detail.facts.some((fact) => fact.name === "waiting")).toBe(false)
    })
})
