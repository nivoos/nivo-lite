import { realInstallation } from "@tests/fixtures/builders/installation-parts.builder"
import { TOOL } from "@nivo-lite/agent-sdk/names"
import { CONTACT, actsOf } from "../../thread-world"
import { recordWritten } from "../../thread-world-intake"
import { runTurns, drain } from "../../thread-world"
import { threadStepsOf } from "../../thread-world-w8-wakes"
import { WS } from "../../thread-world-records"
import { SALES } from "../reconcile/thread-world-money"
import { SP, customerSaysToSale, handedToConsult, saidOf, salesWorldOf, toldOf, type SalesWorld } from "./thread-world-sales"

// S7-WAIT (concept templates rule 12, agent-data rules 2, 4, 7): THE ORDER'S OWN WRITE WAKES THE PARKED SALE. `sales.consult` v33's payment wait
// lists the key `ordered` (a write of `blocks-core.sales.order`, matched on the run's order id) beside `credit` and `said`; the order type
// declares its writes as events keyed by the order itself. A person cancelling the order on the workbench wakes the sale AT ONCE (no clock
// moves): the wake reads the order (`order-now`) and its request (`request-now`), the order no longer waits, the loop leaves and the run ends
// `closed`: no reminder, no thank-you, no stranger notice. The case of the record-keyed second kind in `wait-record-written.spec.ts`.
// Real: the type's DERIVED declaration (from the order type the real installation declares), its translate, `deliver` to the owning agent, the flow's take
// (the waits first), the sale graph on the engine's threads. Faked: the model (scripted), the outside acts, the stores (the world's books).

/** The order record type, as the real installation declares it (the engine reads types from the installation, never from a package by name). */
const orderEntity = (() => {
    const found = realInstallation().entities.find((entity) => entity.name === "blocks-core.sales.order")
    if (found === undefined) throw new Error("the installation declares no blocks-core.sales.order")
    return found
})()

const TRUTHS = [{ id: "fact-basket", subject: "Gio hoa nho", attribute: "gia", value: "2000 d", unit: null, num: 2000 }]
const NONE = { occasions: null, cancelOrderId: null, cancelReason: null }
const DELIVERY = { address: "25 Nguyen Hue", recipientName: "Lan", recipientPhone: "0901 234 567", deliveryAt: "thu Bay 9-11h" }
const LINES = [{ name: "Gio hoa nho", quantity: 2, unitVnd: 2000 }]
const ASKED = { branch: "asked", reply: "Chi Lan oi, 2 gio hoa nho, 4.000 d. Chi dong y nhe?", items: LINES, ...DELIVERY, ...NONE }
const READY = { branch: "ready", reply: null, items: LINES, ...DELIVERY, ...NONE }
const ORDER_NO = "DH-20261113-0001"
const TOLD_BANK = `Don ${ORDER_NO} da ghi: 2 gio hoa nho, tong 4.000 d. Chi chuyen khoan ACB 123456, noi dung ${ORDER_NO} nhe.`

/** Where the run is parked: the park key of its wait, or null when it waits on none. */
const parkedAt = async (world: SalesWorld, runId: string): Promise<string | null> => {
    const view = await world.process.threads.stateOf({ workspaceId: WS, runId })
    const question: unknown = view?.status === "stopped" ? view.stop?.question : undefined
    return typeof question === "object" && question !== null && "parkKey" in question && typeof question.parkKey === "string" ? question.parkKey : null
}

/** The sale up to the order on the SePay account: the consult asks, the person agrees, the request is told; the run parks at its pay wait. */
const ordered = async () => {
    const world = await salesWorldOf(TRUTHS)
    const { db } = world
    db.model.script(SP.consult, { done: ASKED })
    const first = await handedToConsult(world, "2 gio hoa nho giao 25 Nguyen Hue, chi Lan 0901 234 567, thu Bay 9-11h")
    expect(first?.error).toBeNull()
    db.model.script(SP.consult, { done: READY })
    db.model.script(SP.orderTell, { done: { text: TOLD_BANK } })
    const agreed = await customerSaysToSale(world, "Dong y", "m-agree-1")
    expect(agreed.resumed.map((one) => one.error)).toEqual([null])
    const runId = first?.runId ?? ""
    expect(await parkedAt(world, runId)).toBe("pay[r1].await")
    return { world, runId }
}

/** A person changes the order on the workbench: the record's new status, then its write event enters the pipeline; the wakes are run. */
const workbenchSets = async (world: SalesWorld, status: string, version: string) => {
    const order = world.books.orders.get("order-1")
    if (order === undefined) throw new Error("no order")
    order.values = { ...order.values, status }
    const { db, process } = world
    const from = db.wakes.length
    const wakes = await recordWritten(db, {
        type: orderEntity,
        agentId: SALES,
        recordId: "order-1",
        version,
        op: "changed",
        writerKind: "action",
        subject: "order-1",
        contactId: CONTACT,
        fields: { status },
    })
    const ended = await runTurns(process, wakes)
    return { wakes, ended, resumed: await drain(process, from) }
}

describe("v33: a write of the order wakes the parked sale at once", () => {
    it("a workbench CANCEL: the sale wakes now (no clock moved), reads the order, ends `closed`: no reminder, no thank-you, no notice", async () => {
        const { world, runId } = await ordered()
        const said = saidOf(world.db).length
        const told = toldOf(world.db).length
        const sent = actsOf(world.db, TOOL.customerMessageSend).length

        const woke = await workbenchSets(world, "cancelled", "3")

        expect(woke.wakes).toHaveLength(1)
        expect(woke.ended.map((one) => one.ending)).toEqual([expect.objectContaining({ reason: "wait_took" })])
        expect(woke.resumed.map((one) => one.error)).toEqual([null])
        const steps = await threadStepsOf(world.process, runId)
        expect(steps).toEqual(expect.arrayContaining(["pay[r1].order-now", "pay[r1].request-now", "pay[r1].awaiting", "pay[r1].closed-credit", "pay", "settled", "closed"]))
        for (const never of ["pay[r1].remind", "pay[r1].credit", "pay[r1].stranger-read", "pay[r1].late-woke", "to-after-sale", "paid"]) expect(steps).not.toContain(never)
        expect(saidOf(world.db)).toHaveLength(said)
        expect(toldOf(world.db)).toHaveLength(told)
        expect(actsOf(world.db, TOOL.customerMessageSend)).toHaveLength(sent)
        expect(world.books.orders.get("order-1")?.values.status).toBe("cancelled")
    })

    it("a write of an order that STILL waits for money (`invoiced`): the sale wakes, reads it, reminds nobody and waits again", async () => {
        const { world, runId } = await ordered()
        const sent = actsOf(world.db, TOOL.customerMessageSend).length

        const woke = await workbenchSets(world, "invoiced", "3")

        expect(woke.resumed.map((one) => one.error)).toEqual([null])
        const steps = await threadStepsOf(world.process, runId)
        expect(steps).toEqual(expect.arrayContaining(["pay[r1].order-now", "pay[r1].awaiting", "pay[r1].credit-woke", "pay[r1].late-woke"]))
        expect(steps).not.toContain("pay[r1].remind")
        expect(await parkedAt(world, runId)).toBe("pay[r2].await")
        expect(actsOf(world.db, TOOL.customerMessageSend)).toHaveLength(sent)
    })

    it("a write of ANOTHER order wakes nothing: the sale still waits on its own", async () => {
        const { world, runId } = await ordered()
        const { db, process } = world
        const from = db.wakes.length

        const wakes = await recordWritten(db, {
            type: orderEntity,
            agentId: SALES,
            recordId: "order-other",
            version: "2",
            op: "changed",
            writerKind: "action",
            subject: "order-other",
            fields: { status: "cancelled" },
        })
        const ended = await runTurns(process, wakes)
        await drain(process, from)

        expect(ended.map((one) => one.ending?.reason)).not.toContain("wait_took")
        expect(await parkedAt(world, runId)).toBe("pay[r1].await")
    })
})
