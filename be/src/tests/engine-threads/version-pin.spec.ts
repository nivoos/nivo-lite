import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { LanggraphErrorCode } from "@modules/integrations/langgraph"
import { CORE_EDGE, NOTE_READ, NOTE_WRITE } from "@tests/fixtures/builders/engine-core-plugin.builder"
import { CORE, FRONT, WS, button, founderDecides, rowsOf, startThread, stopsOf, threadDbOf, type ThreadDb } from "./thread-world"
import { coreFlowOf, coreProcessOf, noteActsOf, NOTE_TRIGGER } from "./thread-world-core"

// The GENERIC engine core fixture installed beside the core (`engine-core-plugin.builder.ts`; moved off the world's business desk by
// worker E: the same facts, on the generic edge graph `write → check → second write → outcome`).
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const fixture: typeof import("@tests/fixtures/builders/engine-core-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/engine-core-plugin.builder",
    )
    return { installed: parts.installationWith([fixture.CORE_PLUGIN], "engine-core") }
})

// Package 0-9, item 5 (design risk 3): a run started on template version N resumes on N after N+1 is published, also in a process
// that never built N; resuming it on another version is refused by name; a pinned version whose step is not installed runs while it
// can and stops for a person when it REACHES that step (rule Q-5, QB-P6).

/** Version N of the edge graph, as the run pins it (`<agent>:<workflow>@<n>`). */
const VERSION_N = `${FRONT}:edge@1`

/** Version N+1 of the edge graph: the check step renamed `verify`. A thread pinned to N must never run it. */
const renamed = (flow: GraphSpec): GraphSpec => ({
    ...flow,
    nodes: flow.nodes.map((node) =>
        node.key === "first"
            ? { ...node, routes: { ...node.routes, done: "verify" } }
            : node.key === "check"
              ? { ...node, key: "verify" }
              : node,
    ),
})

/** A database whose door answers the check's read from a script: `blocked` first (the edge), then clear. */
const dbOf = (): ThreadDb => {
    const db = threadDbOf()
    return { ...db, rights: { ...db.rights, answers: new Map([[NOTE_READ, [{ blocked: true }, { blocked: false }]]]), asked: [] } }
}

const stoppedOnN = async (db: ThreadDb) => {
    db.model.script(CORE, {
        decision: "report",
        reason: "Ghi chu dang bi khoa.",
        question: "Lam gi tiep?",
        suggestions: [{ text: "Thu lai", handledBy: "workflow" }],
        customerLine: null,
    })
    const process = await coreProcessOf(db)
    const woken = await startThread(process, { flow: coreFlowOf(CORE_EDGE), versionId: VERSION_N, trigger: NOTE_TRIGGER, workflowId: "wf:direct" })
    const runId = woken.runId ?? ""
    const versionNext = `${FRONT}:edge@2`
    db.versions.set(versionNext, { number: 2, flow: renamed(coreFlowOf(CORE_EDGE)) })
    return { runId, versionN: VERSION_N, versionNext }
}

describe("a thread is pinned to the version it started on", () => {
    it("resumes on N after N+1 is published, in a process that never built N; the step of N runs", async () => {
        const db = dbOf()
        const { runId, versionN } = await stoppedOnN(db)

        const restarted = await coreProcessOf(db)
        const ran = await founderDecides(restarted, runId, button(db, "retry"))

        expect(ran.map((one) => one.error)).toEqual([null])
        const view = await restarted.threads.stateOf({ workspaceId: WS, runId })
        expect(view).toMatchObject({ version: versionN, status: "ended" })
        expect(Object.keys(view?.state.steps ?? {})).toEqual(["first", "check", "second", "end"])
        expect(rowsOf(db, runId).steps.map((step) => step.stepKey)).toEqual(["first", "check", "second", "end"])
    })

    it("refuses by name to resume or drive the thread on the graph of another version", async () => {
        const db = dbOf()
        const { runId, versionNext } = await stoppedOnN(db)
        const process = await coreProcessOf(db)
        const ref = { workspaceId: WS, runId }
        const next = await process.graphs.pinned(ref, FRONT, versionNext)

        await expect(process.threads.resume(ref, next, button(db, "retry"))).rejects.toMatchObject({
            code: LanggraphErrorCode.VersionMismatch,
        })
        await expect(process.threads.drive(ref, next)).rejects.toMatchObject({
            code: LanggraphErrorCode.VersionMismatch,
        })
        expect((await process.threads.stateOf(ref))?.status).toBe("stopped")
    })

    // Rule Q-5 (QB-P6): a pinned version runs while it can; a step whose node is no longer installed is ONE engine stop when the run
    // REACHES it (never a refusal of the whole version at the next wake). Kind of workflow here: a plain write, no person, no line.
    it("a pinned version whose LATER node is gone runs its early steps and stops for a person AT that step: one engine card, run in flight", async () => {
        const db = dbOf()
        const { runId, versionN } = await stoppedOnN(db)
        const found = { number: db.versions.get(versionN)?.number ?? 0, flow: coreFlowOf(CORE_EDGE) }
        // A release of the package removed the node the pinned version's LATER step names (the process has never built that version).
        db.versions.set(versionN, {
            number: found.number,
            flow: { ...found.flow, nodes: found.flow.nodes.map((node) => (node.key === "second" ? { ...node, step: "tcore.gone" } : node)) },
        })
        const restarted = await coreProcessOf(db)
        const writesBefore = noteActsOf(db).filter((act) => act.effect === NOTE_WRITE).length

        // The pinned graph builds; the person's Retry runs `check` (now clear) and the run reaches `second`.
        const ran = await founderDecides(restarted, runId, button(db, "retry"))

        expect(ran.map((one) => one.error)).toEqual([null])
        const view = await restarted.threads.stateOf({ workspaceId: WS, runId })
        expect(view).toMatchObject({ version: versionN, status: "stopped" })
        expect(Object.keys(view?.state.steps ?? {})).toEqual(["first", "check"])
        // The early write ran once (before the restart), the gone step wrote nothing.
        expect(noteActsOf(db).filter((act) => act.effect === NOTE_WRITE)).toHaveLength(writesBefore)
        const stops = await stopsOf(restarted, runId)
        expect(stops.map((stop) => [stop.stepKey, stop.state, stop.kind])).toEqual([
            ["check", "resolved", expect.any(String)],
            ["second", "open", "engine"],
        ])
        expect(rowsOf(db, runId).run).toMatchObject({ status: "waiting" })
        expect(rowsOf(db, runId).steps.find((step) => step.stepKey === "second")).toMatchObject({ errorCode: "graph_node_missing" })
        // No AI core was asked for the engine stop: the one scripted report was the first stop's.
        expect(db.model.asked.filter((one) => one.purpose === CORE)).toHaveLength(1)
    })

    it("a new start on a version whose LATER node is gone runs the early steps and stops at that step; Retry stops again; Skip ends the run", async () => {
        const base = threadDbOf()
        // The check reads clear at once: the run goes first -> check -> second.
        const db: ThreadDb = {
            ...base,
            rights: { ...base.rights, answers: new Map([[NOTE_READ, [{ blocked: false }, { blocked: false }]]]), asked: [] },
        }
        const process = await coreProcessOf(db)
        const flow = coreFlowOf(CORE_EDGE)
        const gone = { ...flow, nodes: flow.nodes.map((node) => (node.key === "second" ? { ...node, step: "tcore.gone" } : node)) }

        const started = await startThread(process, { flow: gone, versionId: VERSION_N, trigger: NOTE_TRIGGER, workflowId: "wf:direct" })
        const runId = started.runId ?? ""

        expect(started.error).toBeNull()
        expect(noteActsOf(db).filter((act) => act.effect === NOTE_WRITE)).toHaveLength(1)
        expect((await stopsOf(process, runId)).map((stop) => [stop.stepKey, stop.kind])).toEqual([["second", "engine"]])
        await founderDecides(process, runId, button(db, "retry"))
        expect((await process.threads.stateOf({ workspaceId: WS, runId }))?.status).toBe("stopped")
        expect(noteActsOf(db).filter((act) => act.effect === NOTE_WRITE)).toHaveLength(1)
        await founderDecides(process, runId, button(db, "skip"))
        expect((await process.threads.stateOf({ workspaceId: WS, runId }))?.status).toBe("ended")
        expect(rowsOf(db, runId).run).toMatchObject({ status: "cancelled" })
    })
})
