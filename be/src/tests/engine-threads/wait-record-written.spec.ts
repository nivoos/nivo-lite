import { mock } from "@starci/jest-preset"
import { AgentWorkReadService } from "@modules/domain/agent-work"
import type { RecordEventsSource } from "@modules/domain/record-events"
import { AWAIT_MINUTES, CORE_AGENT, CORE_AWAIT, CORE_REQUEST_TYPE, NOTE_WRITE } from "@tests/fixtures/builders/engine-core-plugin.builder"
import { jobRecordingOutbox } from "@tests/fixtures/builders/queue-job-outbox.builder"
import { FRONT, drain, runTurns, stopsOf, threadDbOf, type ThreadDb } from "./thread-world"
import { coreProcessOf, coreStarted, noteActsOf, threadOf, workflowIdOf } from "./thread-world-core"
import { recordWritten, type WrittenRecord } from "./thread-world-intake"

// ENGINE CORE (S7-WAIT, concept templates rule 12 + agent-data rules 2, 4, 7): A RECORD-KEYED MEANING WAKES A PARKED RUN AT ONCE. The await
// graph's wait has two keys besides its timeout: `completed` (a render's completion) and `renewed` (a write of the fixture's renewal request,
// a record type whose events are keyed by the record itself: no person), matched on the request id the run holds. The second kind beside the
// sale's "a workbench cancel wakes the parked sale" (`workflows/sales-flow/order-cancel-wakes.spec.ts`). Real: the type's DERIVED trigger
// declaration and its translate, `deliver` to the owning agent with the writer named, who listens (a wait of an active workflow lists the
// verb), the flow's take (the waits first; the writing run never offered its own write), the thread engine, the wait node, the drain.
// Faked: the outside world, the test write's executor, the queue outbox.
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const fixture: typeof import("@tests/fixtures/builders/engine-core-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/engine-core-plugin.builder",
    )
    return { installed: parts.installationWith([fixture.CORE_PLUGIN], "engine-core") }
})

/** The fixture's renewal request: its writes are events keyed by the request itself, the newest state wins, its `state` rides on the event. */
const REQUEST: RecordEventsSource = {
    name: CORE_REQUEST_TYPE,
    fields: { state: { kind: "enum" } },
    events: { subject: "id", combine: "latest", members: ["state"] },
}

/** The run's trigger: the note, its line, and the id of the renewal request it waits on (`ticket`). */
const TRIGGER_SCOPE = { noteId: "note-1", text: "bat dau dung", ticket: "request-77", locale: "vi" }

/** The texts the run wrote, in order. */
const linesOf = (db: ThreadDb): ReadonlyArray<unknown> =>
    noteActsOf(db)
        .filter((act) => act.effect === NOTE_WRITE)
        .map((act) => act.payload.text)

/** A run of the await graph of the agent, parked on its wait. */
const parked = async () => {
    const db = threadDbOf({ modules: { [FRONT]: CORE_AGENT } })
    const outbox = jobRecordingOutbox()
    const wakeReader = mock<AgentWorkReadService>({
        wakeContextOf: (_ws: string, agentId: string, source: string, eventKey: string) =>
            Promise.resolve(db.wakes.find((one) => one.agentId === agentId && one.source === source && one.eventKey === eventKey)?.context ?? null),
    })
    const process = await coreProcessOf(db, { outbox, extra: [{ provide: AgentWorkReadService, useValue: wakeReader }] })
    const runId = await coreStarted(process, CORE_AWAIT, TRIGGER_SCOPE)
    return { db, process, runId }
}

/** A write of a renewal request (a person on the workbench unless a writer is named), version `version`. */
const requestWrite = (recordId: string, version: string, over: Partial<WrittenRecord> = {}): WrittenRecord => ({
    type: REQUEST,
    agentId: FRONT,
    recordId,
    version,
    op: "changed",
    writerKind: "action",
    subject: recordId,
    fields: { state: "approved" },
    ...over,
})

/** The write enters the pipeline; every wake it makes is run, then the engine's own wakes that follow (the resume of the run that took it). */
const written = async (world: Awaited<ReturnType<typeof parked>>, write: WrittenRecord) => {
    const { db, process } = world
    const from = db.wakes.length
    const wakes = await recordWritten(db, write)
    const ended = await runTurns(process, wakes)
    const resumed = await drain(process, from)
    return { wakes, ended, resumed }
}

describe("a record-keyed meaning (no person) wakes the parked run at once", () => {
    it("a workbench write of the run's request resumes the SAME run along `renewed`; nothing new starts, no stop", async () => {
        const world = await parked()
        const { db, process, runId } = world
        expect((await threadOf(process, runId)).status).toBe("stopped")
        const runsBefore = db.runs.size

        const came = await written(world, requestWrite("request-77", "2"))

        expect(came.wakes).toHaveLength(1)
        expect(came.ended.map((one) => one.ending)).toEqual([expect.objectContaining({ reason: "wait_took" })])
        const thread = await threadOf(process, runId)
        expect(thread.status).toBe("ended")
        expect(thread.steps.hold).toMatchObject({
            output: { trigger: "renewed", event: { data: { type: CORE_REQUEST_TYPE, recordId: "request-77", op: "changed", fields: { state: "approved" } } } },
        })
        expect(linesOf(db)).toEqual(["bat dau dung", "da doi trang thai"])
        expect(db.runs.size).toBe(runsBefore)
        expect(await stopsOf(process, runId)).toEqual([])
    })

    it("a write of ANOTHER request is no event of this run: nothing resumes, the thread still waits", async () => {
        const world = await parked()
        const { db, process, runId } = world

        const came = await written(world, requestWrite("request-other", "2"))

        expect(came.ended.map((one) => one.ending)).toEqual([expect.objectContaining({ status: "skipped", reason: "no_waiter" })])
        expect((await threadOf(process, runId)).status).toBe("stopped")
        expect(linesOf(db)).toEqual(["bat dau dung"])
    })

    it("the writer exclusion is unchanged: the run's OWN write of its request is never offered back to it", async () => {
        const world = await parked()
        const { db, process, runId } = world

        const came = await written(
            world,
            requestWrite("request-77", "3", { writerKind: "run", writer: { runId, workflowId: workflowIdOf(CORE_AWAIT) } }),
        )

        expect(came.ended.map((one) => one.ending?.reason)).not.toContain("wait_took")
        expect((await threadOf(process, runId)).status).toBe("stopped")
        expect(linesOf(db)).toEqual(["bat dau dung"])
        // A later write by a person still wakes it at once.
        const later = await written(world, requestWrite("request-77", "4"))
        expect(later.ended.map((one) => one.ending)).toEqual([expect.objectContaining({ reason: "wait_took" })])
        expect((await threadOf(process, runId)).steps.hold).toMatchObject({ output: { trigger: "renewed" } })
        expect(AWAIT_MINUTES).toBe(30)
    })
})
