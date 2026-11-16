import { threadStepsOf } from "../../thread-world-w8-wakes"
import { button, customersSay, drain, founderDecides, runTurns } from "../../thread-world"
import { heldWakesOf, holdProvidersOf } from "../reconcile/thread-world-money-holds"
import { SALE_TRUTHS, SP, handedToConsult, salesWorldOf } from "./thread-world-sales"

// E-FIX12 rule A-7 (matrix T-A2c / D-W3-2, coordinator ruling 2026-11-15). Nature: the events of a subject that arrive while its run is
// STOPPED are held behind the run; a person's Retry runs the stopped step again, and that step does NOT swallow them (it never read them);
// they stay held and are offered to the run's NEXT wait that lists them (combined as their trigger declares), else they start the next
// run when the run finishes. Before the fix the retried step's queue snapshot closed them `queued:<run>` and the next wait parked with
// nothing: the person's lines were never answered. Case: lines to a stopped consult (the retried step does not read lines). The second
// kind (`each` events of a subject that is not a person) is `combine-each.spec.ts` + `agent-graph-run-queue.service.spec.ts`.

const REPORT = {
    decision: "report",
    reason: "Khach hoi dieu shop chua co du lieu.",
    question: "Shop co nhan dat hang rieng khong?",
    suggestions: [{ text: "Co", handledBy: "workflow" }],
    customerLine: null,
}

const ROUND = {
    branch: "asked",
    reply: "Da shop nhan dat rieng a.",
    items: [{ name: "Gio hoa nho", quantity: 1, unitVnd: 2000 }],
    address: null,
    recipientName: null,
    recipientPhone: null,
    deliveryAt: null,
    occasions: null,
    cancelOrderId: null,
    cancelReason: null,
}

describe("E-FIX12 rule A-7: events held behind a stopped run are read at its next wait after Retry, never swallowed by the retried step", () => {
    it("3 lines while the consult is stopped: Retry answers the stopped step; the run's next wait takes the held lines; ONE consult turn reads them all", async () => {
        const world = await salesWorldOf(SALE_TRUTHS, () => undefined, holdProvidersOf)
        const { db, process } = world
        db.model.script(SP.consult, { confused: { reason: "Khong co du lieu", question: "Shop co nhan dat hang rieng khong?" } })
        db.model.script(SP.core, REPORT)
        const saleRun = (await handedToConsult(world, "Shop co nhan dat gio hoa rieng khong?"))?.runId ?? ""

        const lines = ["Alo shop", "Shop oi tra loi em voi", "Em can gap a"]
        const wakes = []
        for (const [index, text] of lines.entries()) wakes.push(...(await customersSay(process, [{ text, key: `m-held-${String(index)}` }])))
        await runTurns(process, wakes)
        expect(heldWakesOf(db).length).toBeGreaterThan(0)
        expect(heldWakesOf(db).every((wake) => wake.reason === `waiting:${saleRun}`)).toBe(true)

        // Retry: the stopped round answers; the run reaches its next `hear` wait; the held lines are offered to that wait.
        db.model.script(SP.consult, { done: ROUND }, { done: { ...ROUND, reply: "Da em doc het tin cua chi roi a." } })
        const asked = db.model.askedOf(SP.consult).length
        await founderDecides(process, saleRun, button(db, "retry"))
        const from = db.wakes.length
        // The drain after the park: the released marker goes to the run's wait (wait first), whose take wakes the run.
        await runTurns(process, db.chat.wakes.filter((wake) => wake.state === "pending"))
        await drain(process, from)

        // No line is lost: nothing is held behind the run any more, nothing was closed `queued:` by the retried step.
        expect(heldWakesOf(db)).toEqual([])
        expect(db.chat.wakes.filter((wake) => wake.reason?.startsWith("queued:") === true)).toEqual([])
        // The retried round, then the next round that READ the held lines: two consult turns in all, the second sent the lines.
        expect(db.model.askedOf(SP.consult)).toHaveLength(asked + 2)
        const read = JSON.stringify(db.model.askedOf(SP.consult).at(-1)?.request)
        for (const text of lines) expect(read).toContain(text)
        expect(await threadStepsOf(process, saleRun)).toEqual(expect.arrayContaining(["talk[r1].consult", "talk[r2].hear", "talk[r2].consult"]))
    })
})
