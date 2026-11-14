import { TOOL } from "@nivo-lite/agent-sdk/names"
import { threadPositionOf } from "@modules/domain/agent-threads/thread-sweep.service"
import {
    AGENT_WRITE_PURPOSE,
    CORE_AGENT_WRITE,
    CORE_WRITE_AUTO,
    NOTE_WRITE,
} from "@tests/fixtures/builders/engine-core-plugin.builder"
import {
    ANSWER,
    CONV,
    FRONT,
    UNDERSTAND,
    WS,
    actsOf,
    button,
    customersSay,
    customerWrites,
    drain,
    founderDecides,
    redrive,
    rowsOf,
    runTurns,
    startThread,
    stopsOf,
    threadDbOf,
    type ThreadDb,
    type ThreadProcess,
} from "./thread-world"
import { NOTE_TRIGGER, coreFlowOf, coreProcessOf, coreStarted, heldWakesOf, holdProvidersOf, noteActsOf } from "./thread-world-core"

// The world's desk (a customer line: understand -> answer, the answer's agent sends) AND the generic engine core fixture (plain writes,
// no person, no line) installed beside the core: the two kinds of workflow every crash world below runs (R75).
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const desk: typeof import("@tests/fixtures/builders/thread-desk-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/thread-desk-plugin.builder",
    )
    const fixture: typeof import("@tests/fixtures/builders/engine-core-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/engine-core-plugin.builder",
    )
    return { installed: parts.installationWith([desk.DESK_PLUGIN, fixture.CORE_PLUGIN], "crash-redrive") }
})

// R81-7 (a), (c), (d), QB-P6: the api process is KILLED and a NEW process (the same database: checkpoints, ledgers, wakes, rows) goes on.
// A kill is a drive that never comes back: its model call is held for ever (`ScriptedModel.hold`) and its lease is taken over (a higher
// fence), so even a late write of the dead process would be refused at the saver. The new process re-drives the thread (the sweep's ask,
// `ThreadRunsService.redrive`) or fires the retry timer (`ThreadDeadlinesService.fire`, the job's and the sweep's road).
//   (a) killed mid model call: the step runs again, the model is asked again, no write is repeated (the ledger answers what acted).
//   (c) killed while parked on a retry rung: the new process fires the timer, the step runs ONCE, a second fire runs nothing.
//   (d) killed twice on the same step: the re-drive of that position is spent; the LAST re-drive refuses the step (rule RE-DRIVE SPENT):
//       ONE engine card, the run in flight; the subject stays held (the person's next line waits `waiting:<run>`).

const QUESTION = "Shop mo cua may gio?"
const REPLY = "Shop mo cua tu 8h den 21h a."
const sends = (text: string) => ({ call: { tool: TOOL.customerMessageSend, args: { conversationId: CONV, text } } })
const NOTE_CALL = { call: { tool: NOTE_WRITE, args: { noteId: "n1", text: "x" } } }

/** A new process of the app over the same database, with the subject holds the app composes. */
const processAfterKill = (db: ThreadDb): Promise<ThreadProcess> => coreProcessOf(db, { extra: holdProvidersOf(db) })

/** The dead process's lease is taken over: whatever it still writes is fenced at the saver. */
const killed = (db: ThreadDb, runId: string): void => {
    db.checkpoints.takeOver(runId, db.fence + 1)
}

/** The only run of the world (the run the first wake opened). */
const onlyRun = (db: ThreadDb): string => [...db.runs.keys()][0] ?? ""

/** Where the thread stands now, as the sweep keys its re-drives. */
const positionOf = async (process: ThreadProcess, runId: string): Promise<string> => {
    const view = await process.threads.stateOf({ workspaceId: WS, runId })
    if (view === null) throw new Error("no thread")
    return threadPositionOf(view)
}

/** The customer line on the desk, its `answer` agent held at its `after`-th model call (the process dies there). */
const lineHeldAt = async (db: ThreadDb, after: number) => {
    const first = await processAfterKill(db)
    const held = db.model.hold(ANSWER, after)
    void customerWrites(first, QUESTION)
    await held.entered
    return onlyRun(db)
}

/** The agent-write graph (its agent writes a note, then says it did), its agent held at its `after`-th model call. */
const writeHeldAt = async (db: ThreadDb, after: number) => {
    const first = await processAfterKill(db)
    const held = db.model.hold(AGENT_WRITE_PURPOSE, after)
    void startThread(first, { flow: coreFlowOf(CORE_AGENT_WRITE), versionId: `${FRONT}:agent-write@1`, trigger: NOTE_TRIGGER, workflowId: "wf:direct" })
    await held.entered
    return onlyRun(db)
}

describe("(a) the api is killed mid model call", () => {
    it("customer line: the answer's send acted, its NEXT model call never returns; a new process re-drives: the model is asked again, ONE line", async () => {
        const db = threadDbOf()
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } })
        db.model.script(ANSWER, sends(REPLY))
        const runId = await lineHeldAt(db, 1)
        expect(actsOf(db, TOOL.customerMessageSend)).toHaveLength(1)
        const askedBefore = db.model.askedOf(ANSWER).length

        killed(db, runId)
        db.model.script(ANSWER, sends(REPLY), { done: { reply: REPLY } })
        const fresh = await processAfterKill(db)
        const ran = await redrive(fresh, runId, await positionOf(fresh, runId))

        expect(ran.map((one) => one.error)).toEqual([null])
        expect((await fresh.threads.stateOf({ workspaceId: WS, runId }))?.status).toBe("ended")
        expect(db.model.askedOf(ANSWER).length).toBeGreaterThan(askedBefore)
        // The send is answered by its ledger: the customer got ONE line.
        expect(actsOf(db, TOOL.customerMessageSend)).toHaveLength(1)
        expect(await stopsOf(fresh, runId)).toEqual([])
    })

    it("plain write: the agent's write acted, its NEXT model call never returns; a new process re-drives: asked again, ONE write", async () => {
        const db = threadDbOf()
        db.model.script(AGENT_WRITE_PURPOSE, NOTE_CALL)
        const runId = await writeHeldAt(db, 1)
        expect(noteActsOf(db)).toHaveLength(1)
        const askedBefore = db.model.askedOf(AGENT_WRITE_PURPOSE).length

        killed(db, runId)
        db.model.script(AGENT_WRITE_PURPOSE, NOTE_CALL, { done: { said: "x" } })
        const fresh = await processAfterKill(db)
        const ran = await redrive(fresh, runId, await positionOf(fresh, runId))

        expect(ran.map((one) => one.error)).toEqual([null])
        expect((await fresh.threads.stateOf({ workspaceId: WS, runId }))?.status).toBe("ended")
        expect(db.model.askedOf(AGENT_WRITE_PURPOSE).length).toBeGreaterThan(askedBefore)
        expect(noteActsOf(db)).toHaveLength(1)
        expect(rowsOf(db, runId).run).toMatchObject({ status: "done" })
    })
})

/** The thread's park question, when it is parked. */
const parkOf = async (process: ThreadProcess, runId: string): Promise<Record<string, unknown> | null> => {
    const view = await process.threads.stateOf({ workspaceId: WS, runId })
    const question: unknown = view?.status === "stopped" ? view.stop?.question : null
    return typeof question === "object" && question !== null ? { ...question } : null
}

/** A new process fires the retry timer the dead one armed (the deadline job's road), twice (the job and the sweep), and drains. */
const firedTwiceByNewProcess = async (db: ThreadDb, runId: string) => {
    const fresh = await processAfterKill(db)
    const park = await parkOf(fresh, runId)
    db.clock.advance(9 * 60_000)
    const payload = { workspaceId: WS, runId, stepKey: String(park?.parkKey), repeats: Number(park?.round), answered: -1 }
    const from = db.wakes.length
    const first = await fresh.deadlines?.fire(payload)
    await drain(fresh, from)
    const again = db.wakes.length
    const second = await fresh.deadlines?.fire(payload)
    await drain(fresh, again)
    return { fresh, first, second }
}

describe("(c) the api is killed while the run is parked on a retry rung", () => {
    it("customer line: the send timed out (parked r1); a NEW process fires the timer: the step runs once, ONE delivered line", async () => {
        const db = threadDbOf()
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } })
        db.model.script(ANSWER, sends(REPLY), { done: { reply: REPLY } }, sends(REPLY), { done: { reply: REPLY } }, sends(REPLY), { done: { reply: REPLY } })
        db.chat.channelOutcome = "ambiguous"
        const first = await processAfterKill(db)
        const runId = (await customerWrites(first, QUESTION)).runId ?? ""
        expect(await parkOf(first, runId)).toMatchObject({ kind: "until_round", loopKey: "retry:answer", round: 1 })

        db.chat.channelOutcome = "acknowledged"
        const asked = db.model.askedOf(ANSWER).length
        const { fresh, first: fired } = await firedTwiceByNewProcess(db, runId)

        expect(fired).toBe("admitted")
        expect((await fresh.threads.stateOf({ workspaceId: WS, runId }))?.status).toBe("ended")
        // The step ran ONCE more (one send call, one done), whatever the second fire did.
        expect(db.model.askedOf(ANSWER).length).toBeGreaterThan(asked)
        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[REPLY, "delivered"]])
        expect(await stopsOf(fresh, runId)).toEqual([])
    })

    it("plain write: ECONNREFUSED parked r1; a NEW process fires the timer: the write acts once, the run ends; a second fire runs nothing", async () => {
        const db = threadDbOf()
        db.throwOn.set(NOTE_WRITE, Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))
        const first = await processAfterKill(db)
        const runId = await coreStarted(first, CORE_WRITE_AUTO)
        expect(await parkOf(first, runId)).toMatchObject({ kind: "until_round", loopKey: "retry:write", round: 1 })

        const { fresh, first: fired } = await firedTwiceByNewProcess(db, runId)

        expect(fired).toBe("admitted")
        expect((await fresh.threads.stateOf({ workspaceId: WS, runId }))?.status).toBe("ended")
        // The failed try (it threw before anything was kept) and ONE act of the retry: never a third.
        expect(noteActsOf(db).filter((act) => act.effect === NOTE_WRITE)).toHaveLength(2)
        expect(rowsOf(db, runId).run).toMatchObject({ status: "done" })
    })
})

/**
 * The thread killed twice on the same step: the first drive died, the sweep's re-drive of that position died too. A third process does
 * what the sweep does next: the re-drive of the position is spent (not fresh), so it writes the LAST re-drive, which refuses the step.
 */
const killedTwice = async (db: ThreadDb, runId: string, purpose: string) => {
    killed(db, runId)
    const second = await processAfterKill(db)
    const position = await positionOf(second, runId)
    const held = db.model.hold(purpose)
    void redrive(second, runId, position)
    await held.entered
    killed(db, runId)
    const third = await processAfterKill(db)
    expect(await positionOf(third, runId)).toBe(position)
    const ref = { workspaceId: WS, runId }
    await expect(third.threadRuns.redrive(ref, position)).resolves.toEqual({ kind: "admitted", fresh: false })
    const from = db.wakes.length
    await expect(third.threadRuns.redriveSpent(ref, position)).resolves.toEqual({ kind: "admitted", fresh: true })
    const ran = await drain(third, from)
    // The sweep seeing it again writes nothing: one last re-drive per position.
    await expect(third.threadRuns.redriveSpent(ref, position)).resolves.toEqual({ kind: "admitted", fresh: false })
    return { third, ran }
}

describe("(d) the api is killed twice on the same step: re-drive spent -> ONE card, the run in flight", () => {
    it("customer line: one engine card at `answer` (thread_redrive_exhausted), nothing sent, the person's next line waits behind the run", async () => {
        const db = threadDbOf()
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } })
        const runId = await lineHeldAt(db, 0)

        const { third, ran } = await killedTwice(db, runId, ANSWER)

        expect(ran.map((one) => one.error)).toEqual([null])
        expect((await third.threads.stateOf({ workspaceId: WS, runId }))?.status).toBe("stopped")
        const stops = await stopsOf(third, runId)
        expect(stops.map((stop) => [stop.stepKey, stop.kind, stop.state])).toEqual([["answer", "engine", "open"]])
        expect(stops[0]?.detail.facts.find((fact) => fact.name === "code")?.value).toBe("thread_redrive_exhausted")
        expect(rowsOf(db, runId).run).toMatchObject({ status: "waiting" })
        expect(actsOf(db, TOOL.customerMessageSend)).toEqual([])
        // ONE card for the team: the engine's stop card, never a failed run.
        expect(db.team.filter((card) => card.versions.at(0)?.kind === "workflow.stopped")).toHaveLength(1)

        // Rule Q-1: the run still holds its subject; the person's next line starts no run and waits `waiting:<run>`.
        const understood = db.model.askedOf(UNDERSTAND).length
        const ended = await runTurns(third, await customersSay(third, [{ text: "Alo shop?", key: "m-after-crash" }]))
        expect(ended.map((one) => [one.ending?.status, one.ending?.reason])).toContainEqual(["held", `waiting:${runId}`])
        expect(heldWakesOf(db).map((wake) => wake.reason)).toEqual([`waiting:${runId}`])
        expect(db.model.askedOf(UNDERSTAND)).toHaveLength(understood)
    })

    it("plain write: one engine card at `write`, the run in flight, no write; Retry runs the step again and it ends", async () => {
        const db = threadDbOf()
        const runId = await writeHeldAt(db, 0)

        const { third, ran } = await killedTwice(db, runId, AGENT_WRITE_PURPOSE)

        expect(ran.map((one) => one.error)).toEqual([null])
        const stops = await stopsOf(third, runId)
        expect(stops.map((stop) => [stop.kind, stop.state])).toEqual([["engine", "open"]])
        expect(stops[0]?.detail.facts.find((fact) => fact.name === "code")?.value).toBe("thread_redrive_exhausted")
        expect(rowsOf(db, runId).run).toMatchObject({ status: "waiting" })
        expect(noteActsOf(db)).toEqual([])

        // A person's Retry runs the step again (the refusal was for that last drive only): it writes once and the run ends.
        db.model.script(AGENT_WRITE_PURPOSE, NOTE_CALL, { done: { said: "x" } })
        const retried = await founderDecides(third, runId, button(db, "retry"))
        expect(retried.map((one) => one.error)).toEqual([null])
        expect((await third.threads.stateOf({ workspaceId: WS, runId }))?.status).toBe("ended")
        expect(noteActsOf(db)).toHaveLength(1)
    })
})
