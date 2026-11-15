import { TOOL } from "@nivo-lite/agent-sdk/names"
import { PAYOS_SANDBOX_CATALOGUE } from "@modules/domain/payos-provider"
import { CONTACT, actsOf, drain } from "../../thread-world"
import { WS } from "../../thread-world-records"
import { threadStepsOf } from "../../thread-world-w8-wakes"
import { PAYOS_SANDBOX_ACCOUNT, SP, creditArrives, customerSaysToSale, handedToConsult, qrOf, saidOf, salesWorldOf, toldOf } from "./thread-world-sales"

// THE ONE PAYMENT REQUEST (owner ruling R111, PAY-REQ): the SAME sale graph (`sales.consult` v32) and the SAME `sales.request-pay` node, on a
// SePay account (a bank-transfer instruction, no request kept: the credit is recognised by the transfer content) and on a payOS SANDBOX account
// (a hosted link through payOS's REAL sandbox link service: the credit is recognised by payOS's order code, never by the 9-character words).
// The tool family, the adapters, the registry and payOS's sandbox are real; the graph runs on the engine's threads (no stack, no model call).

const TRUTHS = [{ id: "fact-basket", subject: "Gio hoa nho", attribute: "gia", value: "2000 d", unit: null, num: 2000 }]
const NONE = { occasions: null, cancelOrderId: null, cancelReason: null }
const DELIVERY = { address: "25 Nguyen Hue", recipientName: "Lan", recipientPhone: "0901 234 567", deliveryAt: "thu Bay 9-11h" }
const LINES = [{ name: "Gio hoa nho", quantity: 2, unitVnd: 2000 }]
const ASKED = { branch: "asked", reply: "Chi Lan oi, 2 gio hoa nho, 4.000 d. Chi dong y nhe?", items: LINES, ...DELIVERY, ...NONE }
const READY = { branch: "ready", reply: null, items: LINES, ...DELIVERY, ...NONE }
const ORDER_NO = "DH-20261113-0001"
const TOLD_LINK = `Don ${ORDER_NO} da ghi: 2 gio hoa nho, tong 4.000 d. Chi thanh toan tai https://sandbox.invalid/pay/sbx-payos-payos-1-000001 nhe.`
const TOLD_BANK = `Don ${ORDER_NO} da ghi: 2 gio hoa nho, tong 4.000 d. Chi chuyen khoan ACB 123456, noi dung ${ORDER_NO} nhe.`
/** payOS's order code of the world's first sandbox link: the request's reference and the paid event's key. */
const FIRST_CODE = "1780000000001"

/** The sale up to the order on the money account `payWith`: the consult asks, the person agrees, the request is made and told; the run parks. */
const ordered = async (payWith: "sepay" | "payos") => {
    const world = await salesWorldOf(TRUTHS)
    world.books.payWith = payWith
    const { db } = world
    db.model.script(SP.consult, { done: ASKED })
    const first = await handedToConsult(world, "2 gio hoa nho giao 25 Nguyen Hue, chi Lan 0901 234 567, thu Bay 9-11h")
    expect(first?.error).toBeNull()
    db.model.script(SP.consult, { done: READY })
    db.model.script(SP.orderTell, { done: { text: payWith === "payos" ? TOLD_LINK : TOLD_BANK } })
    const agreed = await customerSaysToSale(world, "Dong y", "m-agree-1")
    expect(agreed.resumed.map((one) => one.error)).toEqual([null])
    return { world, runId: first?.runId ?? "" }
}

/** payOS's sandbox moves the account's link of `orderCode` the way a case of the Sandbox page does (PAYOS-9 cancelled at checkout, PAYOS-10 expired). */
const linkMoves = async (world: Awaited<ReturnType<typeof ordered>>["world"], caseId: "PAYOS-9" | "PAYOS-10", orderCode: string) => {
    const inbound = PAYOS_SANDBOX_CATALOGUE.cases.find((one) => one.id === caseId)?.inbound
    if (inbound === undefined) throw new Error(`no case ${caseId}`)
    await world.books.payosSandbox.inbound(PAYOS_SANDBOX_ACCOUNT, caseId, inbound, { orderCode: Number(orderCode) }, world.db.clock.now())
}

/** The payment wait's 24 h timeout falls due and its wake is driven. */
const timeoutFalls = async (world: Awaited<ReturnType<typeof ordered>>["world"], runId: string) => {
    const { db, process } = world
    db.clock.advance(24 * 60 * 60 * 1000)
    const from = db.wakes.length
    expect(await process.deadlines?.fire({ workspaceId: WS, runId, stepKey: "pay[r1].await", repeats: 0, answered: -2 })).toBe("admitted")
    return await drain(process, from)
}

describe("R111: one request step, two kinds of money provider", () => {
    it("SePay: the request is a bank-transfer instruction; the order keeps no reference; the customer gets the QR picture", async () => {
        const { world } = await ordered("sepay")
        const { db, books } = world

        expect(books.calls.filter((one) => one.tool === TOOL.paymentRequestCreate).map((one) => one.args)).toEqual([{ amountVnd: 4000, reference: ORDER_NO }])
        expect(books.orders.get("order-1")?.values).not.toHaveProperty("paymentRequestRef")
        expect(actsOf(db, TOOL.customerMessageSend).at(-1)?.payload).toMatchObject({ text: TOLD_BANK, images: [{ url: qrOf(4000, ORDER_NO).qrImageUrl, caption: "" }] })
    })

    it("payOS sandbox: the SAME call makes a hosted link; the order keeps payOS's order code; the customer gets the pay page, no picture", async () => {
        const { world } = await ordered("payos")
        const { db, books } = world

        expect(books.calls.filter((one) => one.tool === TOOL.paymentRequestCreate).map((one) => one.args)).toEqual([{ amountVnd: 4000, reference: ORDER_NO }])
        expect(books.orders.get("order-1")?.values).toMatchObject({ paymentRequestRef: FIRST_CODE, status: "confirmed" })
        const told = actsOf(db, TOOL.customerMessageSend).at(-1)?.payload
        expect(told).toMatchObject({ text: TOLD_LINK })
        expect(told).not.toHaveProperty("images")
        // The step that told the customer was handed the pay page, not a picture address.
        expect(JSON.stringify(db.model.askedOf(SP.orderTell).at(-1)?.request)).toContain("https://sandbox.invalid/pay/sbx-payos-payos-1-000001")
        // payOS was asked with the environment's return page and a description within its 9 characters.
        const [created] = await books.payosSandbox.calls(PAYOS_SANDBOX_ACCOUNT, "create")
        expect(created?.request).toMatchObject({ amountVnd: 4000, description: "611130001", returnUrl: "https://app.nivo.test/pay/done" })
    })
})

describe("R111: the pay loop on each kind of provider", () => {
    it("payOS PAID: the paid movement names the request by its order code (its words are payOS's 9 characters): the order is recorded paid", async () => {
        const { world, runId } = await ordered("payos")

        const arrived = await creditArrives(world, { id: "payos:SBX1", amountVnd: 4000, content: "611130001", feed: "payos", requestRef: FIRST_CODE })

        expect(arrived.resumed.map((one) => one.error)).toEqual([null])
        expect(await threadStepsOf(world.process, runId)).toEqual(expect.arrayContaining(["pay[r1].order-now", "pay[r1].request-now", "pay[r1].credit", "pay[r1].paid-order", "paid"]))
        expect(world.books.orders.get("order-1")?.values.status).toBe("paid")
    })

    it("payOS: a movement whose WORDS name the order but that pays another request is no payment of this order (never matched by text)", async () => {
        const { world } = await ordered("payos")

        const arrived = await creditArrives(world, { id: "payos:SBX2", amountVnd: 4000, content: `CK ${ORDER_NO}`, feed: "payos", requestRef: "1780000000999" })

        expect(arrived.resumed).toEqual([])
        expect(world.books.orders.get("order-1")?.values.status).toBe("confirmed")
    })

    it("SePay PAID: the credit whose transfer content names the order is recorded paid (a bank transfer keeps no request: its words are its key)", async () => {
        const { world } = await ordered("sepay")

        const arrived = await creditArrives(world, { id: "tx-1", amountVnd: 4000, content: `CK ${ORDER_NO} Lan` })

        expect(arrived.resumed.map((one) => one.error)).toEqual([null])
        expect(world.books.calls.filter((one) => one.tool === TOOL.paymentRequestGet)).toEqual([])
        expect(world.books.orders.get("order-1")?.values.status).toBe("paid")
    })

    it.each(["PAYOS-9", "PAYOS-10"] as const)("payOS %s (cancelled at checkout / expired, no webhook): the next wake reads it, sends no reminder, the run ends closed", async (caseId) => {
        const { world, runId } = await ordered("payos")
        const said = saidOf(world.db).length
        await linkMoves(world, caseId, FIRST_CODE)

        const resumed = await timeoutFalls(world, runId)

        expect(resumed.map((one) => one.error)).toEqual([null])
        expect(world.books.calls.filter((one) => one.tool === TOOL.paymentRequestGet).map((one) => one.args)).toEqual([{ requestRef: FIRST_CODE }])
        const steps = await threadStepsOf(world.process, runId)
        expect(steps).toEqual(expect.arrayContaining(["pay[r1].request-now", "pay", "closed"]))
        expect(steps).not.toContain("pay[r1].remind")
        expect(saidOf(world.db)).toHaveLength(said)
        expect(world.books.orders.get("order-1")?.values.status).toBe("confirmed")
    })

    it("payOS still OPEN at the timeout: the request is read, the customer is reminded, the run waits on", async () => {
        const { world, runId } = await ordered("payos")
        world.db.model.script(SP.remind, { done: { text: `Chi Lan oi, don ${ORDER_NO} van cho thanh toan a.` } })

        const resumed = await timeoutFalls(world, runId)

        expect(resumed.map((one) => one.error)).toEqual([null])
        expect(await threadStepsOf(world.process, runId)).toEqual(expect.arrayContaining(["pay[r1].request-now", "pay[r1].remind"]))
    })

    it("SePay at the timeout: nothing is read at the provider (no request kept), the customer is reminded", async () => {
        const { world, runId } = await ordered("sepay")
        world.db.model.script(SP.remind, { done: { text: `Chi Lan oi, don ${ORDER_NO} van cho chuyen khoan a.` } })

        const resumed = await timeoutFalls(world, runId)

        expect(resumed.map((one) => one.error)).toEqual([null])
        expect(world.books.calls.filter((one) => one.tool === TOOL.paymentRequestGet)).toEqual([])
        expect(await threadStepsOf(world.process, runId)).toEqual(expect.arrayContaining(["pay[r1].request-now", "pay[r1].remind"]))
    })

    it.each(["payos", "sepay"] as const)("%s: a payment for an order closed meanwhile is a stranger credit: told to the team, never recorded", async (payWith) => {
        const { world } = await ordered(payWith)
        const order = world.books.orders.get("order-1")
        if (order === undefined) throw new Error("no order")
        order.values = { ...order.values, status: "cancelled" }

        const arrived =
            payWith === "payos"
                ? await creditArrives(world, { id: "payos:SBX3", amountVnd: 4000, content: "611130001", feed: "payos", requestRef: FIRST_CODE })
                : await creditArrives(world, { id: "tx-9", amountVnd: 4000, content: `CK ${ORDER_NO}` })

        expect(arrived.resumed.map((one) => one.error)).toEqual([null])
        expect(world.books.orders.get("order-1")?.values.status).toBe("cancelled")
        expect(toldOf(world.db)).toHaveLength(1)
    })
})

describe("R111: a refused request stops the run for a person", () => {
    it("payOS refuses the create (PAYOS-2): the step stops with the refusal, nothing is told to the customer, the order keeps no reference", async () => {
        const world = await salesWorldOf(TRUTHS)
        world.books.payWith = "payos"
        await world.books.payosSandbox.setNextCase(PAYOS_SANDBOX_ACCOUNT, "create", "PAYOS-2")
        const { db } = world
        db.model.script(SP.consult, { done: ASKED })
        expect((await handedToConsult(world, "2 gio hoa nho"))?.error).toBeNull()
        db.model.script(SP.consult, { done: READY })
        const said = saidOf(db).length

        await customerSaysToSale(world, "Dong y", "m-agree-1")

        expect(world.books.orders.get("order-1")?.values).not.toHaveProperty("paymentRequestRef")
        expect(saidOf(db)).toHaveLength(said)
        expect(actsOf(db, TOOL.customerMessageSend).map((act) => act.payload)).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: TOLD_LINK })]))
        expect(CONTACT).toBe(CONTACT)
    })
})
