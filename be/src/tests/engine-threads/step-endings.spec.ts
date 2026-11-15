import type { GraphSpec, GraphSpecNode } from "@nivo-lite/agent-sdk/graph"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { INSTALLED } from "@modules/domain/installed-plugins"
import {
    ENDING_ASK,
    ENDING_CANNOT,
    ENDING_ROUND_CANNOT,
    ENDING_ROUNDS,
    ENDING_SEND,
    ENDING_TEXT,
} from "@tests/fixtures/builders/step-ending-plugin.builder"
import {
    CONTACT,
    CONV,
    WS,
    ZALO,
    customersSay,
    drain,
    itemsOf,
    processOf,
    redrive,
    refOf,
    startThread,
    stopsOf,
    threadDbOf,
    type ThreadDb,
    type ThreadProcess,
} from "./thread-world"
import { CustomerRoutesService } from "@modules/domain/customer-routes/customer-routes.service"
import { chatServicesOf } from "./thread-world-intake"

// RULING R68 (owner 2026-11-14, "cook luôn"): package graphs hold PURE business; a step that ends UNSUCCESSFULLY in a typed way the graph
// does not route on is reported to the team in /chat BY THE ENGINE, and the run follows the step's ONE policy word. Run by the REAL engine
// on threads (the SDK compile of the fixture graphs, the adapter, the thread compiler, the node host's template road, the REAL customer
// send executor over the world's stores, the real approvals, stops and projection). Faked: the outside world (the team chat keeps posts by
// key) and the clock. Each case: ONE team post with the step's facts, the policy followed, nothing silent, no second post on a re-drive.
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const desk: typeof import("@tests/fixtures/builders/thread-desk-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/thread-desk-plugin.builder",
    )
    const ending: typeof import("@tests/fixtures/builders/step-ending-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/step-ending-plugin.builder",
    )
    return { installed: parts.installationWith([desk.DESK_PLUGIN, ending.ENDING_PLUGIN], "step-endings") }
})

/** The order code every notice of the fixture graphs names. */
const CODE = "DH-0042"

/** The catalogue keys of the notice's words (the world's catalogue answers a key as its words: the words are the catalogue's, never coded). */
const WORDS = {
    declined: "agentGraphs.stepEnding.declined",
    cannot: "agentGraphs.stepEnding.cannot",
    exhausted: "agentGraphs.stepEnding.exhausted",
    continued: "agentGraphs.stepEnding.continued",
    exhaustedNext: "agentGraphs.stepEnding.exhaustedNext",
    ended: "agentGraphs.stepEnding.ended",
} as const

/** The catalogue keys of the notice's own fact labels. */
const FACT = {
    step: "agentGraphs.stepEnding.fact.step",
    reason: "agentGraphs.stepEnding.fact.reason",
    route: "agentGraphs.stepEnding.fact.route",
    run: "agentGraphs.stepEnding.fact.run",
} as const

/** The prefix of the key the engine posts an unsuccessful step's notice under. */
const ENDING_KEY = "step-ending:"

/** The generic trigger scope of a run serving the person on the route (route, contact, account), with the graph's own inputs. */
const triggerOf = (code: string) => ({
    eventId: `zalo:m-${code}`,
    routeId: CONV,
    contactId: CONTACT,
    accountId: ZALO,
    subject: { channel: "zalo", id: "zalo-user-1" },
    data: { text: "Shop oi", messageKey: `zalo:m-${code}` },
    text: ENDING_TEXT,
    code,
    locale: "vi",
})

/** The compiled @1 graph of a fixture template (the SDK compile, then the engine's adapter). */
const flowOf = (id: string): GraphSpec => {
    const graph = INSTALLED.templateOf(id)?.versions[0]?.graph
    if (graph === undefined) throw new Error(`no template ${id}`)
    return graph
}

/** The same graph with every declared ending removed: the engine's road as it was before R68. */
const withoutEndings = (flow: GraphSpec): GraphSpec => ({
    ...flow,
    nodes: flow.nodes.map((one): GraphSpecNode => {
        const { unsuccessful: _dropped, ...rest } = one
        return rest
    }),
})

const started = async (process: ThreadProcess, id: string, code: string, flow: GraphSpec = flowOf(id)) => {
    const woken = await startThread(process, { flow, versionId: `${id.replace(".", ":")}@1`, workflowId: `wf:${id}`, trigger: triggerOf(code) })
    return { runId: woken.runId ?? "", error: woken.error }
}

const stateOf = async (process: ThreadProcess, runId: string) => process.threads.stateOf(refOf(runId))

const stepsOf = async (process: ThreadProcess, runId: string): Promise<Readonly<Record<string, unknown>>> =>
    (await stateOf(process, runId))?.state.steps ?? {}

/** The engine's unsuccessful-step notices in the team chat (one message per key; a re-post under a key adds a version). */
const noticesOf = (db: ThreadDb) => db.team.filter((message) => message.key.startsWith(ENDING_KEY))

/** The payload of the one notice: its kind, words and facts. */
const onlyNotice = (db: ThreadDb): Readonly<Record<string, unknown>> => {
    const notices = noticesOf(db)
    expect(notices).toHaveLength(1)
    return notices[0]?.versions.at(-1) ?? {}
}

/** The facts of a notice by their label. */
const factsOf = (payload: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> => {
    const facts: unknown = payload.facts
    if (!Array.isArray(facts)) return {}
    return Object.fromEntries(
        facts.flatMap((fact: unknown) =>
            typeof fact === "object" && fact !== null && typeof Reflect.get(fact, "name") === "string"
                ? [[String(Reflect.get(fact, "name")), String(Reflect.get(fact, "value"))]]
                : [],
        ),
    )
}

/** The person wrote, then two days passed: the Zalo reply window is closed, so the REAL send executor refuses `outside_window`. */
const windowClosed = async (db: ThreadDb, process: ThreadProcess): Promise<void> => {
    await customersSay(process, [{ text: "Shop oi", key: "m-window-1" }])
    db.clock.advance(49 * 3_600_000)
}

describe("E-FIX12 rule A-1 (replaces R68 (a)): a refused write outside is a FAILED ACT, never a business ending", () => {
    it("the send is refused: ONE stop for a person (no notice, no `unsuccessful` ending), the run stays in flight, nothing more runs", async () => {
        const db = threadDbOf()
        const process = await processOf(db)
        await windowClosed(db, process)

        const { runId, error } = await started(process, ENDING_SEND, CODE)

        expect(error).toBeNull()
        expect((await stateOf(process, runId))?.status).toBe("stopped")
        expect(["done", "failed", "cancelled", "skipped"]).not.toContain(db.runs.get(runId)?.status)
        const stops = await stopsOf(process, runId)
        expect(stops.map((stop) => [stop.stepKey, stop.state])).toEqual([["tell", "open"]])
        const facts = Object.fromEntries((stops[0]?.detail.facts ?? []).map((fact) => [fact.name, fact.value]))
        // The stop names the tool and its typed refusal, generically.
        expect(facts).toMatchObject({ code: "GRAPH_NODES_ACT_REFUSED", effect: TOOL.customerMessageSend, outsideRefusal: "outside_window" })
        const steps = await stepsOf(process, runId)
        expect(steps.after).toBeUndefined()
        expect(steps.done).toBeUndefined()
        expect(noticesOf(db)).toEqual([])
        expect(db.lines).toEqual([])
    })

    it("whatever the step declares: the same graph with no `unsuccessful` declaration stops the same way", async () => {
        const db = threadDbOf()
        const process = await processOf(db)
        await windowClosed(db, process)

        const { runId } = await started(process, ENDING_SEND, CODE, withoutEndings(flowOf(ENDING_SEND)))

        expect((await stateOf(process, runId))?.status).toBe("stopped")
        expect((await stopsOf(process, runId)).map((stop) => stop.stepKey)).toEqual(["tell"])
        expect(noticesOf(db)).toEqual([])
    })

    it("a send refused while a member holds the route is no failure for the founder (R45): no stop, no notice, the run ends quietly", async () => {
        const db = threadDbOf()
        // The routes' staff hold, as the app composes it globally (`CustomerRoutesModule`): the step reads the hold the door refused on.
        const process = await processOf(db, { extra: [{ provide: CustomerRoutesService, useValue: chatServicesOf(db).routes }] })
        await customersSay(process, [{ text: "Shop oi", key: "m-hold-1" }])
        await chatServicesOf(db).routes.hold(WS, CONV, "member-1")

        const { runId } = await started(process, ENDING_SEND, CODE)

        expect((await stateOf(process, runId))?.status).toBe("ended")
        expect((await stepsOf(process, runId)).after).toBeUndefined()
        expect(noticesOf(db)).toEqual([])
        expect(await stopsOf(process, runId)).toEqual([])
    })

    it("a delivered send tells nobody", async () => {
        const db = threadDbOf()
        const process = await processOf(db)
        await customersSay(process, [{ text: "Shop oi", key: "m-open-1" }])

        const { runId } = await started(process, ENDING_SEND, CODE)

        expect(await stepsOf(process, runId)).toMatchObject({ tell: { output: { sent: true, refusal: null } }, done: {} })
        expect(db.lines.map((line) => line.text)).toEqual([ENDING_TEXT])
        expect(noticesOf(db)).toEqual([])
    })

    it("a re-drive of the stopped run opens no second stop and sends nothing", async () => {
        const db = threadDbOf()
        const process = await processOf(db)
        await windowClosed(db, process)
        const { runId } = await started(process, ENDING_SEND, CODE)

        await redrive(process, runId, "redrive:act-refused")

        expect((await stopsOf(process, runId)).map((stop) => [stop.stepKey, stop.state])).toEqual([["tell", "open"]])
        expect(db.lines).toEqual([])
    })
})

describe("R68 (b): an approval declined, on a main step (`end`, by default)", () => {
    it("the person declines the send on its card: the team is told once and the run ends at the outcome `declined`", async () => {
        const db = threadDbOf()
        const process = await processOf(db)
        await customersSay(process, [{ text: "Shop oi", key: "m-ask-1" }])
        const { runId, error } = await started(process, ENDING_ASK, CODE)
        expect(error).toBeNull()
        expect((await stopsOf(process, runId)).map((stop) => [stop.stepKey, stop.kind, stop.state])).toEqual([["tell", "approval", "open"]])
        const from = db.wakes.length
        const workItemId = itemsOf(db)[0]?.item.id ?? ""

        const decided = await process.approvals?.decided(
            { workspaceId: WS, runId, stepKey: "tell", workItemId, verdict: "refused", by: "owner-1", text: "" },
            process.requests,
        )
        expect(decided).toMatchObject({ kind: "admitted" })
        await drain(process, from)

        expect((await stateOf(process, runId))?.status).toBe("ended")
        const steps = await stepsOf(process, runId)
        expect(steps.tell).toMatchObject({ output: { sent: false, refusal: "declined" } })
        expect(steps.declined).toMatchObject({ output: { outcome: "declined" } })
        expect(steps.after).toBeUndefined()
        expect(steps.done).toBeUndefined()
        const notice = onlyNotice(db)
        expect(notice.text).toBe(`${WORDS.declined} ${WORDS.ended}`)
        expect(factsOf(notice)).toMatchObject({ "Mã đơn": CODE, [FACT.reason]: `declined (${TOOL.customerMessageSend})` })
        expect(db.lines).toEqual([])
    })
})

describe("R68 (c): an `until` loop that runs out of rounds and declares its notice", () => {
    it("the team is told once (the order, the rounds) and the run takes `exhausted`", async () => {
        const db = threadDbOf()
        const process = await processOf(db)

        const { runId, error } = await started(process, ENDING_ROUNDS, CODE)

        expect(error).toBeNull()
        expect((await stateOf(process, runId))?.status).toBe("ended")
        const steps = await stepsOf(process, runId)
        expect(steps.rounds).toMatchObject({ output: { rounds: 2, stopped: false } })
        expect(steps.gaveup).toMatchObject({ output: { outcome: "gaveup" } })
        expect(steps.done).toBeUndefined()
        const notice = onlyNotice(db)
        expect(notice.text).toBe(`${WORDS.exhausted} ${WORDS.exhaustedNext}`)
        expect(factsOf(notice)).toMatchObject({ "Mã đơn": CODE, [FACT.reason]: "2", [FACT.step]: "rounds" })
        expect(noticesOf(db)[0]?.key).toBe(`${ENDING_KEY}${runId}:rounds:1`)
    })

    it("the same loop declaring no notice runs out quietly (a customer going quiet is normal)", async () => {
        const db = threadDbOf()
        const process = await processOf(db)

        const { runId } = await started(process, ENDING_ROUNDS, CODE, withoutEndings(flowOf(ENDING_ROUNDS)))

        expect(await stepsOf(process, runId)).toMatchObject({ gaveup: { output: { outcome: "gaveup" } } })
        expect(noticesOf(db)).toEqual([])
    })
})

describe("R68 + R75 (E-FIX7): a step INSIDE an until loop's body that declares `end` leaves the loop at its outcome", () => {
    // The defect G-SLIM's slim sale exposed (`paid-order` in the pay loop): the run failed `LANGGRAPH_ROUTE_UNDECLARED` because the until
    // compile dropped the outcome from a body step's routes. Here another kind of workflow: a check with no customer line and no tool.
    it("round 1's check cannot: the team is told once, the run ends at `declined`, the loop frame is cleared, no later step or round runs", async () => {
        const db = threadDbOf()
        const process = await processOf(db)

        const { runId, error } = await started(process, ENDING_ROUND_CANNOT, "")

        expect(error).toBeNull()
        const state = await stateOf(process, runId)
        expect(state?.status).toBe("ended")
        expect(state?.state.loop ?? null).toBeNull()
        const steps = await stepsOf(process, runId)
        const keys = Object.keys(steps)
        expect(keys.filter((key) => key.endsWith("check"))).toHaveLength(1)
        expect(keys.filter((key) => key.endsWith("note"))).toEqual([])
        expect(steps.declined).toMatchObject({ output: { outcome: "declined" } })
        expect(steps.done).toBeUndefined()
        expect(steps.gaveup).toBeUndefined()
        const notice = onlyNotice(db)
        expect(notice.text).toBe(`${WORDS.cannot} ${WORDS.ended}`)
        expect(factsOf(notice)[FACT.reason]).toBe("NODE_CANNOT: no_order_code")
        expect(await stopsOf(process, runId)).toEqual([])
    })

    it("the control: a check that can runs every round quietly and the loop ends by its own `exhausted`", async () => {
        const db = threadDbOf()
        const process = await processOf(db)

        const { runId } = await started(process, ENDING_ROUND_CANNOT, CODE)

        const steps = await stepsOf(process, runId)
        expect(steps.gaveup).toMatchObject({ output: { outcome: "gaveup" } })
        expect(steps.declined).toBeUndefined()
        expect(noticesOf(db)).toEqual([])
    })
})

describe("R68 (d): a node that says it cannot, on a step that goes on (`continue`)", () => {
    it("no stop card, no AI core: the team is told once (the node's typed reason) and the run goes on to its next step", async () => {
        const db = threadDbOf()
        const process = await processOf(db)

        const { runId, error } = await started(process, ENDING_CANNOT, "")

        expect(error).toBeNull()
        expect((await stateOf(process, runId))?.status).toBe("ended")
        const steps = await stepsOf(process, runId)
        expect(steps.check).toMatchObject({ output: null, failed: "NODE_CANNOT", unsuccessful: true })
        expect(steps.after).toMatchObject({ output: { noted: "" } })
        expect(steps.done).toMatchObject({ output: { outcome: "done" } })
        const notice = onlyNotice(db)
        expect(notice.text).toBe(`${WORDS.cannot} ${WORDS.continued}`)
        // The order code is empty: a fact that reads nothing is left out of the notice.
        expect(factsOf(notice)).not.toHaveProperty("Mã đơn")
        expect(factsOf(notice)[FACT.reason]).toBe("NODE_CANNOT: no_order_code")
        expect(await stopsOf(process, runId)).toEqual([])
    })

    it("a check that can: nobody is told", async () => {
        const db = threadDbOf()
        const process = await processOf(db)

        const { runId } = await started(process, ENDING_CANNOT, CODE)

        expect(await stepsOf(process, runId)).toMatchObject({ check: { output: { checked: CODE } }, done: {} })
        expect(noticesOf(db)).toEqual([])
    })

    it("declaring nothing, the same `cannot` keeps the failure road (a stop for a person)", async () => {
        const db = threadDbOf()
        const process = await processOf(db)

        const { runId } = await started(process, ENDING_CANNOT, "", withoutEndings(flowOf(ENDING_CANNOT)))

        expect((await stopsOf(process, runId)).map((stop) => [stop.stepKey, stop.state])).toEqual([["check", "open"]])
        expect(noticesOf(db)).toEqual([])
    })
})
