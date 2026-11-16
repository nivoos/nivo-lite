import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import type { AgentRunsService } from "@modules/domain/agent-runs"
import { ThreadParkedDeadlinesService } from "@modules/domain/agent-threads"
import {
    ANSWER,
    CONTACT,
    CONV,
    UNDERSTAND,
    WS,
    ZALO,
    customerWrites,
    drain,
    itemsOf,
    processOf,
    startThread,
    stopsOf,
    threadDbOf,
    type ThreadDb,
    type ThreadProcess,
} from "./thread-world"

// The world's desk installed beside the core (as stops.spec.ts).
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const desk: typeof import("@tests/fixtures/builders/thread-desk-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/thread-desk-plugin.builder",
    )
    return { installed: parts.installationWith([desk.DESK_PLUGIN], "world-desk") }
})

// ENGINE-FIN (b), the dev time levers: every parked thread has ONE deadline road, and the dev door (the Sandbox page's "expire now") fires ANY parked
// deadline now through it (`ThreadParkedDeadlinesService.fireNow` -> `ThreadDeadlinesService.fireNow`), the same function the job calls
// when the time runs out. The wait's timeout is `sandbox-expire-wait.spec.ts`; here the two other kinds: a retry-ladder rung (an act of
// unknown outcome, parked on its 1-minute pause) and an approval's expiry (24 hours). Real: the thread engine, the ladder, the approvals,
// the deadline road, the drain. Doubles: the outside world, the run list's query (the world's store has none).

/** The generic door over the world, its run list being the one run given. */
const doorOf = (process: ThreadProcess, runId: string): ThreadParkedDeadlinesService => {
    const runs = {
        inFlightThreads: async () => {
            const run = await process.runs.runOf(WS, runId)
            return run === null ? [] : [run]
        },
    } as unknown as AgentRunsService
    if (process.deadlines === undefined) throw new Error("the world has no deadlines")
    return new ThreadParkedDeadlinesService(runs, process.deadlines, process.stops, process.threads)
}

/** Fires the run's deadline now through the door, then drains the wake it wrote. */
const firedNow = async (db: ThreadDb, process: ThreadProcess, door: ThreadParkedDeadlinesService, runId: string) => {
    const from = db.wakes.length
    const firing = await door.fireNow(WS, runId)
    await drain(process, from)
    return firing
}

const sends = (text: string) => ({ call: { tool: TOOL.customerMessageSend, args: { conversationId: CONV, text } } })

describe("ENGINE-FIN (b): the dev door fires any parked deadline now, through the one deadline road", () => {
    it("a retry-ladder rung: listed as `retry` with its park key, fired NOW (no 1-minute wait): the recorded send is made again and delivered", async () => {
        const reply = "Shop mo cua tu 8h a."
        const db = threadDbOf()
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } })
        db.model.script(ANSWER, sends(reply), { done: { reply } })
        db.chat.channelOutcome = "ambiguous"
        const process = await processOf(db)
        const runId = (await customerWrites(process, "Shop mo cua may gio?")).runId ?? ""
        const door = doorOf(process, runId)

        expect(await door.parked(WS, 10)).toEqual([
            expect.objectContaining({ runId, kind: "retry", parkKey: "retry:answer[r1]", waitsFor: [] }),
        ])

        db.chat.channelOutcome = "acknowledged"
        // The clock is NOT advanced: the lever is the time.
        await expect(firedNow(db, process, door, runId)).resolves.toBe("admitted")

        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[reply, "delivered"]])
        expect(await stopsOf(process, runId)).toEqual([])
        expect(await door.parked(WS, 10)).toEqual([])
        await expect(door.fireNow(WS, runId)).resolves.toBe("closed")
    })

    it("an approval's expiry: listed as `approval`, fired NOW: the stop takes the deadline's timeout, nothing is sent, the deadline fires once", async () => {
        const text = "Shop mo cua tu 8h den 21h a."
        const askingFlow: GraphSpec = {
            schema: "nivo/agent-graph@1",
            moduleKey: "chatbot",
            trigger: { kind: "tag", sources: [] },
            grant: { tools: [TOOL.brainSearch], effects: [TOOL.customerMessageSend] },
            nodes: [
                {
                    key: "answer",
                    kind: "output",
                    step: "wdesk.answer",
                    mode: "ask",
                    params: { conversationId: { $ref: "trigger.routeId" }, text: { $ref: "trigger.data.text" } },
                },
            ],
        }
        const db = threadDbOf()
        db.model.script(ANSWER, { call: { tool: TOOL.customerMessageSend, args: { text } } }, { done: { reply: text } })
        const process = await processOf(db)
        const started = await startThread(process, {
            flow: askingFlow,
            versionId: "chatbot-agent:ask-send@1",
            workflowId: "wf:ask-send",
            trigger: {
                eventId: "zalo:m-ask-1",
                routeId: CONV,
                contactId: CONTACT,
                accountId: ZALO,
                subject: { channel: "zalo", id: "zalo-user-1" },
                data: { text: "Shop mo cua may gio?", messageKey: "zalo:m-ask-1" },
                locale: "vi",
            },
        })
        const runId = started.runId ?? ""
        const door = doorOf(process, runId)

        expect(await door.parked(WS, 10)).toEqual([expect.objectContaining({ runId, kind: "approval", parkKey: "answer", waitsFor: [] })])

        await expect(firedNow(db, process, door, runId)).resolves.toBe("admitted")

        expect(db.lines).toEqual([])
        expect(db.chat.ledger.rows.filter((row) => row.state === "delivered")).toEqual([])
        // The expiry is the owner's item refused by the engine (no person): the stop took the deadline's `timeout` and the step ran again
        // with the refusal as data (here the world's model has no more words, so the step stops again for a person: not an approval).
        const [stop] = await stopsOf(process, runId)
        expect(stop?.answers.map((one) => one.kind)).toContain("timeout")
        expect(stop?.kind).not.toBe("approval")
        expect(itemsOf(db)).toHaveLength(1)
        // A deadline fires ONCE per stop: the same stop is never offered again on a ladder of timeouts.
        expect((await door.parked(WS, 10)).filter((one) => one.kind === "approval")).toEqual([])
    })
})
