import { TOOL } from "@nivo-lite/agent-sdk/names"
import { ANSWER, CONV, UNDERSTAND, WS, button, customerWrites, drain, founderDecides, processOf, stopsOf, threadDbOf } from "./thread-world"

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

// R74 / item 6 (QUEUE-DESIGN A.6 (a)): when the channel timed out or failed AFTER the request left, the customer send was recorded
// "outcome unknown" and handed back to the node AS A SUCCESS: the step completed as if it had answered; no card, nothing re-sent.
// General rule: a tool call whose outcome is unknown is never returned to the step as a success.

const REPLY = "Shop mo cua tu 8h den 21h a."
const sends = (text: string) => ({ call: { tool: TOOL.customerMessageSend, args: { conversationId: CONV, text } } })


// QUEUE-BUILD rule Q-3 (R74, R80/R81): the customer send DECLARES itself `repeatable`, so its unknown outcome is no stop: the run parks on
// the step (rule Q-2) and the step runs again after the pause, sending under the SAME key (the send ledger takes the ended-unknown key
// back); the worst case is a duplicate line. The second kind of workflow (a write that is not repeatable) is `retry-park.spec.ts`.

/** The thread's park question, when it is parked. */
const parkOf = async (process: Awaited<ReturnType<typeof processOf>>, runId: string): Promise<Record<string, unknown> | null> => {
    const view = await process.threads.stateOf({ workspaceId: WS, runId })
    const question: unknown = view?.status === "stopped" ? view.stop?.question : null
    return typeof question === "object" && question !== null ? { ...question } : null
}

describe("a customer send whose outcome nobody knows is never a success, and is sent again under the same key", () => {
    it("the answer's send times out: parked on a retry (no stop, nothing claims to have answered, ledger `unknown`); the channel back, the timer re-sends ONCE under the same key", async () => {
        const db = threadDbOf()
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } })
        // Each run of the answer step asks its agent turns afresh (the retry is a new visit: nothing of the failed one is replayed).
        db.model.script(ANSWER, sends(REPLY), { done: { reply: REPLY } }, sends(REPLY), { done: { reply: REPLY } }, sends(REPLY), { done: { reply: REPLY } })
        db.chat.channelOutcome = "ambiguous"
        const process = await processOf(db)

        const runId = (await customerWrites(process, "Shop mo cua may gio?")).runId ?? ""

        expect(await stopsOf(process, runId)).toEqual([])
        const park = await parkOf(process, runId)
        expect(park).toMatchObject({ kind: "until_round", loopKey: "retry:answer", round: 1 })
        expect(db.lines).toEqual([])
        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[REPLY, "unknown"]])

        db.chat.channelOutcome = "acknowledged"
        db.clock.advance(2 * 60_000)
        const from = db.wakes.length
        await expect(
            process.deadlines?.fire({ workspaceId: WS, runId, stepKey: String(park?.parkKey), repeats: 1, answered: -1 }),
        ).resolves.toBe("admitted")
        await drain(process, from)

        expect(await stopsOf(process, runId)).toEqual([])
        // ONE ledger row: the same send key, claimed again and delivered.
        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[REPLY, "delivered"]])
    })
})

// E-FIX12 rule A-2 (matrix T-A1c / T-A3a / T-A3b / T-C1): each automatic retry re-ran the model, the act key hashed the new words, so N
// tries made N ledger rows, N `unknown` lines and N differently worded messages. The act of a step position is its RECORDED intent: the
// retry makes THAT act again under the SAME key with no model call; only once it is settled does the node run to finish the step, and its
// write at that position is answered by the receipt. The second kind (a plain write, not a send) is in `tool-runner.service.spec.ts`
// (the kept intent made again as recorded) and `graph-node-effects.service.spec.ts` (open acts, acts counted).
describe("E-FIX12 rule A-2: one recorded intent and one key per step position across every retry", () => {
    it("the model writes other words each time: the retries resend the FIRST words under the first key, never ask the model to write again, ONE row", async () => {
        const first = "Shop mo cua tu 8h a."
        const second = "Da, shop mo cua 8h sang a."
        const db = threadDbOf()
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } })
        db.model.script(ANSWER, sends(first), { done: { reply: first } }, sends(second), { done: { reply: second } })
        db.chat.channelOutcome = "ambiguous"
        const process = await processOf(db)
        const runId = (await customerWrites(process, "Shop mo cua may gio?")).runId ?? ""
        const askedFirst = db.model.askedOf(ANSWER).length
        expect(await parkOf(process, runId)).toMatchObject({ loopKey: "retry:answer", round: 1 })

        // Rung 1: the channel still answers nothing clear: the recorded act is made again, nothing new is written, no model call.
        const fire = async (): Promise<void> => {
            const park = await parkOf(process, runId)
            db.clock.advance(9 * 60_000)
            const from = db.wakes.length
            await expect(
                process.deadlines?.fire({ workspaceId: WS, runId, stepKey: String(park?.parkKey), repeats: Number(park?.round), answered: -1 }),
            ).resolves.toBe("admitted")
            await drain(process, from)
        }
        await fire()
        expect(await parkOf(process, runId)).toMatchObject({ loopKey: "retry:answer", round: 2 })
        expect(db.model.askedOf(ANSWER)).toHaveLength(askedFirst)
        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[first, "unknown"]])

        // Rung 2: the channel is back: the SAME words under the SAME key are delivered; the node finishes; its new words are never sent.
        db.chat.channelOutcome = "acknowledged"
        await fire()
        expect(await stopsOf(process, runId)).toEqual([])
        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[first, "delivered"]])
        // E-FIX12 rule A-6: the node finished the step on the RECORDED model turns: the turn that wrote the words is replayed, not asked
        // again; only the turn AFTER the act (which the first try never reached: it stopped at the unknown) is asked, once, and the step's
        // output states the words that were delivered, never a second wording.
        expect(db.model.askedOf(ANSWER)).toHaveLength(askedFirst + 1)
        // That one turn is the CONTINUATION: it is sent the replayed call and its delivered receipt, never a fresh start.
        expect(JSON.stringify(db.model.askedOf(ANSWER).at(-1)?.request.turns ?? null)).toContain("delivered")
        const view = await process.threads.stateOf({ workspaceId: WS, runId })
        expect(JSON.stringify(view?.state.steps)).toContain(first)
        expect(JSON.stringify(view?.state.steps)).not.toContain(second)
    })
})

// ENGINE-FIN (c): an EXHAUSTED ladder is the outcome-unknown stop (the act's outcome is still unknown): ONE stop that keeps the act's
// code, the acts made and the retries; Retry is offered because the tool is `repeatable`. A person's Retry then takes the SAME road as
// every rung: the recorded intent under the same key, the recorded model turns replayed: no fresh wording. (Before: the visit after a
// person's Retry dropped the retry code, so the model was asked afresh and the step's output carried a second wording.) The second kind
// (a run about no person, a repeatable act that is no send; a deadline's timeout; words) is `agent-threads/thread-step.retry-road.spec.ts`.
describe("ENGINE-FIN (c): the exhausted ladder's stop, and a person's Retry on the one retry road", () => {
    it("four rungs still unknown: ONE stop with the act's code; Retry with the channel back: the FIRST words delivered under the first key, the model asked only for the turn after the act", async () => {
        const first = "Shop mo cua tu 8h a."
        const second = "Da, shop mo cua 8h sang a."
        const db = threadDbOf()
        db.model.script(UNDERSTAND, { done: { branch: "question", summary: "Lan: gio mo cua" } })
        db.model.script(ANSWER, sends(first), { done: { reply: first } }, sends(second), { done: { reply: second } })
        db.chat.channelOutcome = "ambiguous"
        const process = await processOf(db)
        const runId = (await customerWrites(process, "Shop mo cua may gio?")).runId ?? ""
        const askedFirst = db.model.askedOf(ANSWER).length
        for (const round of [1, 2, 3, 4]) {
            const park = await parkOf(process, runId)
            expect(park).toMatchObject({ loopKey: "retry:answer", round })
            db.clock.advance(9 * 60_000)
            const from = db.wakes.length
            await expect(
                process.deadlines?.fire({ workspaceId: WS, runId, stepKey: String(park?.parkKey), repeats: round, answered: -1 }),
            ).resolves.toBe("admitted")
            await drain(process, from)
        }

        const stops = await stopsOf(process, runId)
        expect(stops).toHaveLength(1)
        const facts = Object.fromEntries((stops[0]?.detail.facts ?? []).map((fact) => [fact.name, fact.value]))
        expect(facts).toMatchObject({ code: "delivery_outcome_unknown", effect: TOOL.customerMessageSend, made: "5", retries: "4" })
        expect(facts.retry).toBeUndefined()
        const view = await process.threads.stateOf({ workspaceId: WS, runId })
        expect(view?.state.trouble).toMatchObject({ stepKey: "answer", code: "delivery_outcome_unknown" })
        expect(db.model.askedOf(ANSWER)).toHaveLength(askedFirst)
        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[first, "unknown"]])

        db.chat.channelOutcome = "acknowledged"
        await founderDecides(process, runId, button(db, "retry"))

        expect(db.chat.ledger.rows.map((row) => [row.text, row.state])).toEqual([[first, "delivered"]])
        expect(db.model.askedOf(ANSWER)).toHaveLength(askedFirst + 1)
        expect(JSON.stringify(db.model.askedOf(ANSWER).at(-1)?.request.turns ?? null)).toContain("delivered")
        const after = await process.threads.stateOf({ workspaceId: WS, runId })
        expect(JSON.stringify(after?.state.steps)).toContain(first)
        expect(JSON.stringify(after?.state.steps)).not.toContain(second)
        expect((await stopsOf(process, runId))[0]).toMatchObject({ state: "resolved", decision: { kind: "retry" } })
    })
})
