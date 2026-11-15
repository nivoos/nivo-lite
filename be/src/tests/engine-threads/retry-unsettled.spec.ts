import { TOOL } from "@nivo-lite/agent-sdk/names"
import { GraphNodesError, GraphNodesErrorCode } from "@modules/domain/graph-nodes"
import { memoryToolReceipts } from "@tests/fixtures/builders/tool-receipts-memory.builder"
import {
    ANSWER,
    CONV,
    UNDERSTAND,
    button,
    customerWrites,
    founderDecides,
    processOf,
    stopsOf,
    threadDbOf,
    type ThreadDb,
} from "./thread-world"
import { threadOf } from "./thread-world-core"

// The world's desk (a customer's line) installed beside the core.
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const desk: typeof import("@tests/fixtures/builders/thread-desk-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/thread-desk-plugin.builder",
    )
    return { installed: parts.installationWith([desk.DESK_PLUGIN], "retry-unsettled") }
})

// RETRY-FIX (dev R9-44): a person pressed Retry on a stop whose write had FAILED (the cause then removed), and the gateway answered the
// recorded failure again from its durable receipt: the tool was not called. NATURE: the ledgers record an intent before an outside act
// and then its result; only a SETTLED result (the act happened) is answered from the record; an unsettled one (unknown, refused, failed,
// not sent) is never a receipt: a retry makes the act again under the SAME key with the SAME arguments (the recorded model turns are
// replayed, so the words do not change); an unknown one only by the tool's declaration (`repeatable` / `confirmBy`). One road for every
// retry: the ladder's rung, the sweep's re-drive, a deadline's timeout, a person's Retry.

/** The record write the desk's answer step makes (a default record tool of every node, on the door's TOOL road). */
const RECORD_ARGS = { type: "wdesk.order", values: { text: "10 hong do, 16h mai" } }
const RECORD_OTHER = { type: "wdesk.order", values: { text: "muoi bong hong" } }
const RECORD = (args: typeof RECORD_ARGS) => ({ call: { tool: TOOL.recordCreate, args } }) as const
const SEND = (text: string) => ({ call: { tool: TOOL.customerMessageSend, args: { conversationId: CONV, text } } }) as const
const WRITTEN = {
    record: { id: "rec-0001", version: "1", createdAt: "2026-11-10T10:00:00.000Z", updatedAt: "2026-11-10T10:00:00.000Z", values: {} },
}

/** The door's failure of a write the connector could not make (dev R9: a database grant missing; the gateway's `unavailable`). */
const unavailable = (): GraphNodesError =>
    new GraphNodesError({ code: GraphNodesErrorCode.ToolFailed, params: { tool: TOOL.recordCreate, reason: "unavailable" } })

/** A world database whose door puts the gateway's REAL durable receipt behind the scripted record write. */
const receiptDbOf = (answers: Array<unknown>): ThreadDb => {
    const db0 = threadDbOf()
    const { receipts } = memoryToolReceipts()
    return { ...db0, rights: { ...db0.rights, answers: new Map([[TOOL.recordCreate, answers]]), receipts, acted: [], asked: [] } }
}

describe("RETRY-FIX the case (R9-44): a write that failed is made again by a person's Retry, under the same key", () => {
    it("the record write fails: one stop; the cause removed, Retry: the write IS called again with the same arguments and key, succeeds, the run goes on; the model is not asked to write again", async () => {
        const db = receiptDbOf([unavailable(), WRITTEN])
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Mai: dat hoa" } })
        // The first attempt: the write fails (the agent loop keeps the failure and freezes the node when the loop ends), the model answers
        // the customer (the step requires its send) and ends its turn. A second wording is scripted after it: a fresh model turn on the
        // retry would write THAT (another key, another act, another line).
        db.model.script(ANSWER, RECORD(RECORD_ARGS), SEND("Da nhan don a."), { done: { reply: "Da nhan don a." } })
        db.model.script(ANSWER, RECORD(RECORD_OTHER), SEND("Shop da ghi don a."), { done: { reply: "Shop da ghi don a." } })
        const process = await processOf(db)

        const runId = (await customerWrites(process, "Cho 1 bo hong do 10 bong, giao 16h mai")).runId ?? ""

        const stops = await stopsOf(process, runId)
        expect(stops.map((stop) => [stop.stepKey, stop.state])).toEqual([["answer", "open"]])
        const facts = Object.fromEntries((stops[0]?.detail.facts ?? []).map((fact) => [fact.name, fact.value]))
        expect(facts).toMatchObject({ code: GraphNodesErrorCode.ToolFailed, reason: "unavailable" })
        expect(db.rights.acted?.map((one) => [one.tool, one.args])).toEqual([[TOOL.recordCreate, RECORD_ARGS]])
        const askedFirst = db.model.askedOf(ANSWER).length

        await founderDecides(process, runId, button(db, "retry"))

        // The write was MADE again (the receipt kept `unavailable`, which settles nothing), with the recorded arguments, under the first key.
        const acted = db.rights.acted ?? []
        expect(acted.map((one) => [one.tool, one.args])).toEqual([
            [TOOL.recordCreate, RECORD_ARGS],
            [TOOL.recordCreate, RECORD_ARGS],
        ])
        expect(acted[1]?.key).toBe(acted[0]?.key)
        // The turns that decided the write were replayed: no model call for what was decided, the second wording never asked; the
        // customer's line (settled in the first attempt) was answered by its receipt: ONE line.
        expect(db.model.askedOf(ANSWER)).toHaveLength(askedFirst)
        expect(db.model.left(ANSWER)).toBe(3)
        expect(db.lines.map((line) => line.text)).toEqual(["Da nhan don a."])
        expect((await stopsOf(process, runId))[0]).toMatchObject({ state: "resolved", decision: { kind: "retry" } })
        expect((await threadOf(process, runId)).status).not.toBe("stopped")
    })

    it("a write that SUCCEEDED is answered from its receipt on a retry: no second write (no double act)", async () => {
        const db = receiptDbOf([WRITTEN])
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Mai: dat hoa" } })
        // The step's write succeeds, then its customer send fails (once): the step stops after a settled write.
        db.model.script(ANSWER, RECORD(RECORD_ARGS), SEND("Da ghi don."), { done: { reply: "Da ghi don." } })
        db.throwOn.set(
            TOOL.customerMessageSend,
            new GraphNodesError({ code: GraphNodesErrorCode.ToolFailed, params: { tool: TOOL.customerMessageSend, reason: "refused" } }),
        )
        const process = await processOf(db)
        const runId = (await customerWrites(process, "Cho 1 bo hong do 10 bong, giao 16h mai")).runId ?? ""
        expect(db.rights.acted).toHaveLength(1)

        expect((await stopsOf(process, runId)).map((stop) => [stop.stepKey, stop.state])).toEqual([["answer", "open"]])
        await founderDecides(process, runId, button(db, "retry"))

        // Asked again under the same key on the retry (the replayed words), the settled write is answered by its receipt: the
        // connector acted ONCE; the send that failed was made again and the run went on.
        const asked = db.rights.asked?.filter((one) => one.tool === TOOL.recordCreate) ?? []
        expect(asked.map((one) => one.key)).toEqual([asked[0]?.key, asked[0]?.key])
        expect(db.rights.acted).toHaveLength(1)
        expect(db.lines.map((line) => line.text)).toEqual(["Da ghi don."])
        expect((await stopsOf(process, runId))[0]).toMatchObject({ state: "resolved", decision: { kind: "retry" } })
    })
})
