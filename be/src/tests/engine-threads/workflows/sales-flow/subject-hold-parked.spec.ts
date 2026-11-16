import { mockEntityManager } from "@starci/jest-preset"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { AGENT_RUNS } from "@tests/fixtures/builders/engine-core-tables.builder"
import { TIMER_DUE_TRIGGER } from "@modules/domain/agent-schedules/engine-time.triggers"
import { triggerDeclarations } from "@modules/domain/provider-triggers"
import { CONTACT, CONV, actsOf, runTurns } from "../../thread-world"
import { chatServicesOf, type HeardWake } from "../../thread-world-intake"
import { WS } from "../../thread-world-records"
import { threadStepsOf } from "../../thread-world-w8-wakes"
import { SALES } from "../reconcile/thread-world-money"
import { heldWakesOf, holdProvidersOf } from "../reconcile/thread-world-money-holds"
import { SP, creditArrives, customerSaysToSale, handedToConsult, salesWorldOf, type SalesWorld } from "./thread-world-sales"

// RULE Q-1 ACROSS TWO WORKFLOWS WHILE A SALE IS PARKED (RESTART-R8 smoke row "q"): the dev smoke could not show "a second workflow's event for a
// person is HELD while that person's run is parked, then released". This world reproduces the smoke's road on the INSTALLED graphs and puts the
// missing event in: a customer line -> front desk -> `sales.consult` (the REAL hand-off) -> the order is recorded -> the run PARKS at its
// payment wait (`pay[r1].await`, which listens for the bank credit that names the order and for the person's lines on the four channels,
// `consult.graph.ts` `SAID` + `await`). While it is parked, an event of ANOTHER workflow of the same agent for the SAME person arrives that the
// wait does NOT listen for: the care timer of `sales.delivery-check` (`delivery-check.graph.ts` trigger `timer.due`, `where data.data.kind =
// delivery-check`; the engine's timer entry delivers it with the arming run's contact and route beside the event, `ClockTickDeliveryService.deliverTimer`).
//
// Rule under test (one holding rule, Q-1): a run not finished keeps its SUBJECT for every workflow; an event naming that person that no wait took
// waits behind the run as a held wake `waiting:<run>`, starts nothing, and is pending again when the run is finished, combined as its trigger
// declares (the timer due declares `latest`: the newest due of a task stands for the older ones, Q-4).
// REAL: the installed sales + front-desk graphs, the hand-off (`deliver` of `workflow.called`), the Zalo entry, the bank feed's entry, the timer's
// declaration + translate + `deliver` (MATCH over the installed graphs), the subject hold (both halves), the thread runs. Doubles: the model
// (scripted), the outside acts, the stores, the wake table (the world's, the same pure decisions).

const TRUTHS = [
    { id: "fact-basket", subject: "Gio hoa nho", attribute: "gia", value: "2000 d", unit: null, num: 2000 },
    { id: "fact-pay", subject: "thanh toan", attribute: "chuyen khoan", value: "ACB 123456, Hoa Shop" },
]
const SUMMARY = "Chi Lan oi, shop tom tat: 2 gio hoa nho (2.000 d/gio), giao 25 Nguyen Hue, chi Lan 0901 234 567, thu Bay 9-11h. Chi dong y nhe?"
const TOLD = "Don DH-20261113-0001 da ghi: 2 gio hoa nho, tong 4.000 d. Chi chuyen khoan ACB 123456 (Hoa Shop), noi dung DH-20261113-0001 nhe."
const NONE = { occasions: null, cancelOrderId: null, cancelReason: null }
const DELIVERY = { address: "25 Nguyen Hue", recipientName: "Lan", recipientPhone: "0901 234 567", deliveryAt: "thu Bay 9-11h" }
const LINES = [{ name: "Gio hoa nho", quantity: 2, unitVnd: 2000 }]
const ASKED = { branch: "asked", reply: SUMMARY, items: LINES, ...DELIVERY, ...NONE }
const READY = { branch: "ready", reply: null, items: LINES, ...DELIVERY, ...NONE }
const ORDER_TALK = "sales.order-talk:agent"
const ABOUT = "Don cua chi 4.000 d, chuyen ACB 123456 nhe."

/** The sale up to the order with the REAL hold composed: it parks at its payment wait. */
const parkedAtPayment = async (): Promise<{ readonly world: SalesWorld; readonly saleRun: string }> => {
    const world = await salesWorldOf(TRUTHS, () => undefined, holdProvidersOf)
    const { db } = world
    db.model.script(SP.consult, { call: { tool: TOOL.brainSearch, args: { query: "gio hoa nho gia" } } }, { done: ASKED })
    const first = await handedToConsult(world, "2 gio hoa nho giao 25 Nguyen Hue, chi Lan 0901 234 567, thu Bay 9-11h")
    expect(first?.error).toBeNull()
    db.model.script(SP.consult, { done: READY })
    db.model.script(SP.orderTell, { done: { text: TOLD } })
    const agreed = await customerSaysToSale(world, "Dong y", "m-agree-1")
    expect(agreed.resumed.map((one) => one.error)).toEqual([null])
    const saleRun = first?.runId ?? ""
    expect(await threadStepsOf(world.process, saleRun)).toEqual(expect.arrayContaining(["tell-order"]))
    expect(db.records.get(AGENT_RUNS, saleRun)?.data.waitMatch).not.toEqual(null)
    return { world, saleRun }
}

/** The care timer of a delivery check falls due for a person, as the minute sweep's entry hands it: the real translate and `deliver`, the person beside the event. */
const careTimerDue = async (
    world: SalesWorld,
    due: { readonly taskId: string; readonly dueAt: string; readonly contactId?: string; readonly routeId?: string; readonly kind?: string },
): Promise<ReadonlyArray<HeardWake>> => {
    const { chat } = world.db
    triggerDeclarations.register(TIMER_DUE_TRIGGER)
    const before = chat.wakes.length
    const event = TIMER_DUE_TRIGGER.translate(
        { taskId: due.taskId, ref: `care:${due.taskId}`, data: { kind: due.kind ?? "delivery-check", record: "order-0" }, dueAt: due.dueAt },
        { connectionId: null },
    )
    if (event === null) throw new Error("the due does not translate")
    await chatServicesOf(world.db).triggers.deliver(
        {
            workspaceId: WS,
            declaration: TIMER_DUE_TRIGGER,
            connectionId: null,
            agentId: SALES,
            events: [{ event, contactId: due.contactId ?? CONTACT, routeId: due.routeId ?? CONV, occurredAt: due.dueAt }],
        },
        mockEntityManager(),
    )
    return chat.wakes.slice(before)
}

const DUE_1 = "2026-11-13T09:00:00.000Z"
const DUE_2 = "2026-11-13T09:30:00.000Z"
const PAYS = { id: "tx-1", amountVnd: 4000, content: "CK DH-20261113-0001 Lan" }

describe("rule Q-1 across two workflows: a sale parked at its payment wait holds its person", () => {
    it("the payment wait listens ONLY for the bank credit and the person's lines: the other workflow's care timer is no event of it", async () => {
        const { world, saleRun } = await parkedAtPayment()
        const { db } = world

        // The sale is parked (a wait, in flight) and its wait is marked for exactly the events it takes.
        expect(db.records.get(AGENT_RUNS, saleRun)?.data.waitMatch).not.toEqual(null)
        const due = await careTimerDue(world, { taskId: "task-dc-1", dueAt: DUE_1 })
        // The installed `sales.delivery-check` registers the timer (one wake of the sales agent, scope = the task); no wait of the sale takes it.
        expect(due).toHaveLength(1)
        expect(due[0]).toMatchObject({ agentId: SALES, state: "pending", scopeKey: "key:data.taskId=task-dc-1" })
        expect(due[0]?.context).toMatchObject({ contactId: CONTACT, conversationId: CONV })
    })

    it("the timer of the OTHER workflow for the same person is HELD `waiting:<sale run>`: no second run starts, no model call, nothing sent", async () => {
        const { world, saleRun } = await parkedAtPayment()
        const { db, process } = world
        const runsBefore = [...db.runs.keys()]
        const sentBefore = actsOf(db, TOOL.customerMessageSend).length

        const due = await careTimerDue(world, { taskId: "task-dc-1", dueAt: DUE_1 })
        const ended = await runTurns(process, due)

        expect(ended.map((one) => [one.ending?.status, one.ending?.reason])).toEqual([["held", `waiting:${saleRun}`]])
        expect(heldWakesOf(db).map((wake) => wake.reason)).toEqual([`waiting:${saleRun}`])
        expect([...db.runs.keys()]).toEqual(runsBefore)
        expect(actsOf(db, TOOL.customerMessageSend)).toHaveLength(sentBefore)
        // The sale is untouched: still parked at its payment wait.
        expect(db.records.get(AGENT_RUNS, saleRun)?.data.waitMatch).not.toEqual(null)
        expect(await threadStepsOf(process, saleRun)).not.toContain("pay[r1].credit")
    })

    it("a line of the person is TAKEN by the payment wait (it listens for the person's lines): nothing is held, the front desk starts no run", async () => {
        const { world, saleRun } = await parkedAtPayment()
        const { db, process } = world
        db.model.script(ORDER_TALK, { done: { topic: "about", reply: ABOUT } })

        const said = await customerSaysToSale(world, "Don cua em tong bao nhieu a?", "m-ask-2")

        expect(said.ended.map((one) => [one.ending?.status, one.ending?.reason])).toEqual([
            ["done", "wait_took"],
            ["skipped", "no_waiter"],
        ])
        expect(heldWakesOf(db)).toEqual([])
        expect([...db.runs.keys()]).toEqual([saleRun])
        expect(await threadStepsOf(process, saleRun)).toEqual(expect.arrayContaining(["pay[r1].order-talk"]))
    })

    it("the credit pays the order: the sale ends and the held timer is released and begins ONE `sales.delivery-check` run", async () => {
        const { world, saleRun } = await parkedAtPayment()
        const { db, process } = world
        const due = await careTimerDue(world, { taskId: "task-dc-1", dueAt: DUE_1 })
        await runTurns(process, due)
        expect(heldWakesOf(db)).toHaveLength(1)

        const paid = await creditArrives(world, PAYS)

        expect(paid.resumed.map((one) => one.error)).toEqual([null])
        expect(world.books.orders.get("order-1")?.values.status).toBe("paid")
        // The sale is finished: the wake held behind it is pending again (the SAME wake; nothing written anew).
        expect(heldWakesOf(db)).toEqual([])
        expect(due[0]).toMatchObject({ state: "pending" })
        const runsBefore = db.runs.size

        const taken = await runTurns(process, due)

        expect(taken).toHaveLength(1)
        expect(taken[0]?.error).toBeNull()
        expect(taken[0]?.runId).not.toBe(saleRun)
        expect(db.runs.size).toBe(runsBefore + 1)
        expect(heldWakesOf(db)).toEqual([])
        // The run is the installed `sales.delivery-check` workflow's (its start step is `wait`).
        expect((await threadStepsOf(process, taken[0]?.runId ?? "")).at(0)).toBe("wait")
    })

    it("two dues of ONE task while parked (the timer declares `latest`): ONE held wake, ONE run after the credit, on the NEWEST due", async () => {
        const { world } = await parkedAtPayment()
        const { db, process } = world

        const first = await careTimerDue(world, { taskId: "task-dc-1", dueAt: DUE_1 })
        await runTurns(process, first)
        const second = await careTimerDue(world, { taskId: "task-dc-1", dueAt: DUE_2 })
        await runTurns(process, second)

        // The older due is closed `replaced:<newer>` (it begins nothing, never offered again); one wake stays held, standing for both.
        expect(first[0]).toMatchObject({ state: "queued", reason: `replaced:${second[0]?.id ?? ""}` })
        expect(heldWakesOf(db)).toHaveLength(1)
        expect(second[0]?.context).toMatchObject({ combine: "latest", count: "2" })

        await creditArrives(world, PAYS)
        const runsBefore = db.runs.size
        const taken = [...(await runTurns(process, first)), ...(await runTurns(process, second))]

        expect(taken).toHaveLength(1)
        expect(taken[0]?.error).toBeNull()
        expect(db.runs.size).toBe(runsBefore + 1)
        expect(JSON.parse(String(second[0]?.context.dataJson))).toMatchObject({ taskId: "task-dc-1", dueAt: DUE_2 })
    })

    it("CONTROL: a timer due for ANOTHER person is held by nobody: it begins its own run at once", async () => {
        const { world } = await parkedAtPayment()
        const { db, process } = world
        const runsBefore = db.runs.size

        const due = await careTimerDue(world, { taskId: "task-dc-9", dueAt: DUE_1, contactId: "contact-other", routeId: "route-other" })
        const ended = await runTurns(process, due)

        expect(heldWakesOf(db)).toEqual([])
        expect(ended.map((one) => one.ending?.reason ?? null)).not.toContain(expect.stringMatching(/^waiting:/))
        expect(db.runs.size).toBe(runsBefore + 1)
    })

    it("a held timer survives a re-park of the sale (a line answered, the wait parks again): it is offered again and held again, never run beside the sale", async () => {
        const { world, saleRun } = await parkedAtPayment()
        const { db, process } = world
        const due = await careTimerDue(world, { taskId: "task-dc-1", dueAt: DUE_1 })
        await runTurns(process, due)
        db.model.script(ORDER_TALK, { done: { topic: "about", reply: ABOUT } })

        await customerSaysToSale(world, "Don cua em tong bao nhieu a?", "m-ask-2")
        // Offered again at the sale's re-park (rule Q-1: a run that parks offers the held events to its wait first), the timer is no event of that
        // wait, so it meets the holder again.
        await runTurns(process, due)

        expect(heldWakesOf(db).map((wake) => wake.reason)).toEqual([`waiting:${saleRun}`])
        expect(db.runs.has(saleRun)).toBe(true)
        expect([...db.runs.keys()]).toEqual([saleRun])
    })
})
