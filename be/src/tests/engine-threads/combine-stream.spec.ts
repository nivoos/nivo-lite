import { TOOL } from "@nivo-lite/agent-sdk/names"
import { AgentGraphRunQueueService } from "@modules/domain/agent-graphs/agent-graph-run-queue.service"
import { StreamCursorService } from "@modules/domain/customer-routes"
import { MemoryStreamCursorStore } from "@tests/fixtures/builders/customer-routes-stores.builder"
import { holdProvidersOf } from "./thread-world-core"
import { ANSWER, CONV, UNDERSTAND, WS, customersSay, processOf, runHeard, threadDbOf, type ThreadDb, type ThreadProcess } from "./thread-world"

// RULE Q-4 `stream` + THE STREAM CURSOR (QB-P5 C-2, C-4), the customer-line kind (R75 exposing world). The Zalo line declares
// `combine: "stream"`. (1) While the person's run is busy, four lines are ONE marker (the OLDEST, count 4, `since`), held behind the run;
// when it ends, ONE next run starts on the marker, its `hear` reads the stream AFTER the cursor (all four lines, though the shop answered
// the first run AFTER they arrived: the old "after the shop's last line" would have read none), and ONE answer goes out. (2) A line a run
// read and handled WITHOUT a reply (it handed the person on) is consumed: the next run does not read it again (owner defect O-R6-2).
// Real: the Zalo entry, `deliver`, the wake table's combine (the world's double runs the engine's pure decision), the flow's hold, the
// thread engine, the projection's step end folding the read into the cursor (`StreamCursorService`), the core front desk (hear, understand,
// answer). Doubles: the model, the wake table and the stream rows (memory).

const sends = (text: string) => ({ call: { tool: TOOL.customerMessageSend, args: { conversationId: CONV, text } } })

/** A world with the stream cursor on: the thread read answers positions and the cursor; a step's end folds its read. */
const cursorWorld = (): { readonly db: ThreadDb; readonly cursor: MemoryStreamCursorStore } => {
    const db = threadDbOf()
    const cursor = new MemoryStreamCursorStore()
    db.chat.cursor = cursor
    return { db, cursor }
}

const processWithCursor = (db: ThreadDb, cursor: MemoryStreamCursorStore): Promise<ThreadProcess> =>
    processOf(db, {
        extra: [...holdProvidersOf(db), AgentGraphRunQueueService, { provide: StreamCursorService, useValue: new StreamCursorService(cursor) }],
    })

/** The thread state of a run: its trigger and the outputs of its steps. */
const stateOf = async (process: ThreadProcess, runId: string) =>
    (await process.threads.stateOf({ workspaceId: WS, runId }))?.state as
        | { trigger?: { data?: { text?: string }; count?: number; since?: string }; steps?: Record<string, { output?: { text?: string; messages?: ReadonlyArray<unknown> } }> }
        | undefined

/** The lines delivered to the person, in order. */
const toldOf = (db: ThreadDb): ReadonlyArray<string> =>
    db.chat.ledger.rows.filter((row) => row.routeId === CONV && row.state === "delivered").map((row) => row.text)

describe("stream marker + stream cursor: lines held behind a busy run are ONE marker and ONE answer", () => {
    it("4 lines during a busy run: ONE marker (oldest, count 4, since), ONE next run reading all four after the cursor, ONE answer", async () => {
        const { db, cursor } = cursorWorld()
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } }, { done: { branch: "question", summary: "Lan: dat hoa" } })
        db.model.script(ANSWER, sends("Shop mo 8h-21h a"), { done: { reply: "Shop mo 8h-21h a" } }, sends("Da, shop giao toi nay a"), { done: { reply: "Da, shop giao toi nay a" } })
        const process = await processWithCursor(db, cursor)
        const paused = db.model.hold(UNDERSTAND)

        const first = await customersSay(process, [{ text: "Shop mo cua may gio?", key: "m-s0" }])
        const running = runHeard(process, first)
        await paused.entered
        const firstRun = [...db.runs.keys()][0] ?? ""
        // hear of the first run read the stream and ENDED: its read is the cursor (the first line).
        expect(cursor.rows.get(CONV)?.consumed).not.toBeNull()

        const four = await customersSay(process, [
            { text: "Cho minh dat hoa", key: "m-s1" },
            { text: "Mot bo huong duong", key: "m-s2" },
            { text: "Giao toi nay duoc khong", key: "m-s3" },
            { text: "Cam on shop", key: "m-s4" },
        ])
        // ONE marker: the OLDEST stays (count 4, the newest event named); three are closed behind it at delivery.
        const markerId = four[0]?.id ?? ""
        expect(four.map((wake) => wake.reason ?? null)).toEqual([null, ...Array(3).fill(`coalesced:${markerId}`)])
        expect(four[0]?.context).toMatchObject({ combine: "stream", eventId: "m-s1", count: "4", latestEventId: "m-s4" })
        const held = await runHeard(process, four)
        expect(held.ending).toEqual({ status: "held", reason: `waiting:${firstRun}`, outcome: null })
        expect([...db.runs.keys()]).toEqual([firstRun])

        paused.release()
        expect((await running).error).toBeNull()
        // The first run answered its line AFTER the four lines arrived (its answer step ran after them).
        expect(toldOf(db)).toEqual(["Shop mo 8h-21h a"])

        const next = await runHeard(process, four)
        expect(next.error).toBeNull()
        const secondRun = next.runId ?? ""
        expect([...db.runs.keys()]).toEqual([firstRun, secondRun])
        const state = await stateOf(process, secondRun)
        // The trigger: the one-event shape of the OLDEST line, plus `since` and `count`.
        expect(state?.trigger?.data?.text).toBe("Cho minh dat hoa")
        expect(state?.trigger?.count).toBe(4)
        expect(typeof state?.trigger?.since).toBe("string")
        // hear read the stream AFTER the cursor: all four lines, once (the shop's answer of the first run is later than all of them).
        expect(state?.steps?.hear?.output?.text).toBe("Cho minh dat hoa\nMot bo huong duong\nGiao toi nay duoc khong\nCam on shop")
        // ONE answer for the four lines.
        expect(toldOf(db)).toEqual(["Shop mo 8h-21h a", "Da, shop giao toi nay a"])
        expect(four.map((wake) => wake.state)).toEqual(["begun", "queued", "queued", "queued"])
    })

    it("a line a run read and handled WITHOUT a reply is consumed: the next run reads only the new line (O-R6-2)", async () => {
        const { db, cursor } = cursorWorld()
        // Run 1 hands the person on (`buy`: the front desk tells nothing); run 2 answers a question.
        db.model.script(UNDERSTAND, { done: { branch: "buy", summary: "Lan: huy don" } }, { done: { branch: "question", summary: "Lan: hoa" } })
        db.model.script(ANSWER, sends("Da co a"), { done: { reply: "Da co a" } })
        const process = await processWithCursor(db, cursor)

        const one = await runHeard(process, await customersSay(process, [{ text: "Huy don DH-1 nhe", key: "m-o1" }]))
        expect(one.error).toBeNull()
        expect(toldOf(db)).toEqual([])
        const two = await runHeard(process, await customersSay(process, [{ text: "Co hoa huong duong khong?", key: "m-o2" }]))
        expect(two.error).toBeNull()

        // The second run's hear reads only the new line: the first was consumed by the run that read it, though nobody replied to it.
        expect((await stateOf(process, two.runId ?? ""))?.steps?.hear?.output?.text).toBe("Co hoa huong duong khong?")
        expect(toldOf(db)).toEqual(["Da co a"])
    })

    it("CONTROL, no cursor (the old reader): the same two runs read the unanswered first line again", async () => {
        const db = threadDbOf()
        db.model.script(UNDERSTAND, { done: { branch: "buy", summary: "Lan: huy don" } }, { done: { branch: "question", summary: "Lan: hoa" } })
        db.model.script(ANSWER, sends("Da co a"), { done: { reply: "Da co a" } })
        const process = await processOf(db, { extra: [...holdProvidersOf(db), AgentGraphRunQueueService] })

        await runHeard(process, await customersSay(process, [{ text: "Huy don DH-1 nhe", key: "m-c1" }]))
        const two = await runHeard(process, await customersSay(process, [{ text: "Co hoa huong duong khong?", key: "m-c2" }]))

        expect((await stateOf(process, two.runId ?? ""))?.steps?.hear?.output?.text).toBe("Huy don DH-1 nhe\nCo hoa huong duong khong?")
    })
})
