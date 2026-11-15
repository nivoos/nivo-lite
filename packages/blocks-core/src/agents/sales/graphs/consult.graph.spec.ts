import { TRIGGER } from "@nivo-lite/agent-sdk/names"
import { callInputsOf } from "@nivo-lite/agent-sdk/graph"
import type { GraphV2Step, StoredExpr, StoredRef } from "@nivo-lite/agent-sdk/graph"
import type { JsonValue } from "@nivo-lite/agent-sdk/schema"
import { exprHolds } from "@nivo-lite/agent-sdk/template"
import { salesConsultTurnNode } from "../nodes/consult-turn.node"
import { salesCreditReadNode } from "../nodes/credit-read.node"
import { salesNotSaleNoticeNode } from "../nodes/not-sale-notice.node"
import { salesOrderCreateNode } from "../nodes/order-create.node"
import { salesOrderPaidNode } from "../nodes/order-paid.node"
import { salesOrderReadNode } from "../nodes/order-read.node"
import { salesRequestPayNode } from "../nodes/request-pay.node"
import { salesRequestReadNode } from "../nodes/request-read.node"
import { salesRequestCancelNode } from "../nodes/request-cancel.node"
import { salesOrderCancelNode } from "../nodes/order-cancel.node"
import { salesOrderCancelTellNode } from "../nodes/order-cancel-tell.node"
import { salesOrderTalkNode } from "../nodes/order-talk.node"
import { orderEntity } from "../entities/order.entity"
import { salesConsultGraph } from "./consult.graph"

// The SALE AS ONE RUN (owner's final rule 7, 2026-11-14): the talk, the order and the payment wait are one graph; the reminder is the
// payment wait's timeout; no `recentLines` is handed in. Importing the graph builds it: reaching here means every save check holds.
// v24 (R32, R33): each round of the talk starts with the wait (round 1, which has no event, skips it); ONE consult reads THAT round's
// message; `off` hands it back in a round that waited, ends `not-sale` in round 1; the payment wait takes money IN only and a credit off
// the total tells the team too. v25 (R41): Q10 round 1 not about a sale tells the team the route and the words; Q8 a declined paid record
// ends the payment loop. v26/v28 (S5c, S5d): the conditions are evaluated against the nodes' OWN example outputs and the loop output the
// engine records. v30 (R68, owner "cook luôn"): PURE BUSINESS. Every "was it declined / not delivered -> team notice" pair of v25-v29 is
// gone: the step declares its `unsuccessful` ending and the ENGINE tells the team (one post per ending, the same count as the old notice
// nodes), then goes on (`continue`) or ends at the declared outcome (`end`). What the team is told is now the engine's card (its kind and
// the facts the step declares); the outcomes are the same.

const steps = salesConsultGraph.spec.nodes
const stepOf = (key: string): GraphV2Step | undefined => steps.find((step) => step.key === key)

/** The stored condition of an if-step, or the `until` of a loop. */
const conditionOf = (key: string, member: "when" | "until"): StoredExpr => {
    const step = stepOf(key) as { readonly params: Readonly<Record<string, StoredExpr>> } | undefined
    const found = step?.params[member]
    if (found === undefined) throw new Error(`no ${member} on ${key}`)
    return found
}

/** A reader of refs over a run scope: a dotted path into `scope`, else the ref's default. */
const readerOf =
    (scope: Readonly<Record<string, JsonValue>>) =>
    (ref: StoredRef): JsonValue => {
        const path = ref.$ref.split(".")
        let at: JsonValue | undefined = scope as JsonValue
        for (const part of path) at = at !== null && typeof at === "object" && !Array.isArray(at) ? (at as Record<string, JsonValue>)[part] : undefined
        return at === undefined ? (ref.default ?? null) : at
    }

/** The output a node's own example answers, found by a member of it. */
const exampleOutput = (examples: ReadonlyArray<{ readonly output?: unknown }>, has: (output: Record<string, JsonValue>) => boolean): Record<string, JsonValue> => {
    const found = examples.map((example) => example.output as Record<string, JsonValue> | undefined).find((output) => output !== undefined && has(output))
    if (found === undefined) throw new Error("no such example output")
    return found
}

/** The ref paths an expression reads, every leaf. */
const refsOf = (expr: unknown): ReadonlyArray<string> => {
    if (expr === null || typeof expr !== "object") return []
    if ("$ref" in expr && typeof expr.$ref === "string") return [expr.$ref]
    return Object.values(expr).flatMap((part) => refsOf(part))
}

describe("sales.consult v34: the sale as one run", () => {
    // v28 (ruling R45): the hand-off also carries the visit's start (`since`): the consult reads the engine's thread itself.
    it("is version 34, called by the front desk with the route, the words, the channel, the person and the visit's start (no recentLines)", () => {
        expect(salesConsultGraph.key).toBe("sales.consult")
        expect(salesConsultGraph.spec.catalogue?.version).toBe(34)
        expect(salesConsultGraph.spec.triggers).toEqual([{ verb: TRIGGER.workflowCalled }])
        expect(callInputsOf(salesConsultGraph.spec.contract).map((one) => one.name).toSorted()).toEqual(["channel", "contactId", "conversationId", "since", "text"])
        const consult = JSON.stringify((stepOf("consult") as { params: unknown }).params)
        expect(consult).toContain('"$ref":"trigger.data.since"')
        expect(consult).not.toContain("recentLines")
    })

    it("talks in a loop of at most 30 rounds: round 1 consults the hand-off, later rounds wait for the person's next message first", () => {
        expect(stepOf("talk")).toMatchObject({ kind: "loop", params: { mode: "until", max: 30 }, next: "keep-occasions", routes: { exhausted: "quiet" } })
        expect(stepOf("opening")).toMatchObject({ kind: "if", loop: "talk", params: { when: { op: "eq", ref: { $ref: "item.$round" }, value: 1 } }, routes: { yes: "consult", no: "hear" } })
        expect(stepOf("hear")).toMatchObject({ kind: "wait", step: "core.wait", loop: "talk", routes: { said: "consult" } })
        expect(steps.filter((step) => step.kind === "node" && step.step === "sales.consult-turn").map((step) => step.key)).toEqual(["consult"])
        // Only the draft comes from the round before (R13); the message is this round's.
        expect(JSON.stringify(stepOf("consult"))).toContain('"round":"previous"')
        expect(JSON.stringify((stepOf("consult") as { params: unknown }).params)).toContain('"$ref":"steps.hear.output.event.data.text","default":null}')
        // Not about a sale: handed back in a round that waited; round 1 ends the talk.
        expect(stepOf("consult")).toMatchObject({ routes: { off: "off-round" } })
        expect(stepOf("off-round")).toMatchObject({ kind: "if", routes: { yes: "not-sale-notice", no: "give-back-talk" } })
        expect(stepOf("give-back-talk")).toMatchObject({ kind: "hand-back", key: "give-back-talk", loop: "talk", step: "core.hand-back", params: { wait: "hear" } })
    })

    it("the payment wait takes money IN only, and a credit off the total tells the customer and the team (R32)", () => {
        expect(JSON.stringify(stepOf("await"))).toContain('{"param":"data.direction","op":"equals","value":"in"}')
        expect(stepOf("short")).toMatchObject({ next: "short-notice" })
        expect(stepOf("short-notice")).toMatchObject({ kind: "node", step: "sales.credit-notice", loop: "pay" })
    })

    it("records the order, asks the customer to pay and tells them, then waits for the money in a loop of at most 6 rounds", () => {
        expect(stepOf("create-order")).toMatchObject({ step: "sales.order-create", next: "request-pay" })
        expect(stepOf("request-pay")).toMatchObject({ step: "sales.request-pay", next: "tell-order" })
        expect(stepOf("tell-order")).toMatchObject({ next: "pay" })
        expect(stepOf("pay")).toMatchObject({ kind: "loop", params: { mode: "until", max: 6 }, next: "settled", routes: { exhausted: "unpaid" } })
        // A credit and the timeout first read the order as it stands now (U-04); a message goes to `order-talk` as before.
        expect((stepOf("await") as { routes: Record<string, string> }).routes).toEqual({ credit: "order-now", said: "order-talk", ordered: "order-now", timeout: "order-now" })
    })

    it("a message during the payment wait goes to order-talk, routed by meaning; the reminder is the wait's timeout", () => {
        expect(stepOf("order-talk")).toMatchObject({ kind: "node", step: "sales.order-talk", loop: "pay", routes: { off: "give-back" } })
        // `about` ends the round (no route written: the engine's round end); `off` hands the event the payment wait took back (R11).
        expect((stepOf("order-talk") as { routes: Record<string, string> }).routes).not.toHaveProperty("about")
        expect(stepOf("give-back")).toMatchObject({ kind: "hand-back", key: "give-back", loop: "pay", step: "core.hand-back", params: { wait: "await" } })
        expect(stepOf("remind")).toMatchObject({ kind: "node", step: "sales.payment-remind", loop: "pay" })
        expect(stepOf("remind")).not.toHaveProperty("next")
        expect(stepOf("paid-order")).toMatchObject({ kind: "node", step: "sales.order-paid", loop: "pay" })
    })

    it("round 1 not about a sale tells the team the route and the words inside the round, then ends not-sale (R41 Q10)", () => {
        expect(stepOf("not-sale-notice")).toMatchObject({ kind: "node", step: "sales.not-sale-notice", loop: "talk" })
        expect(stepOf("not-sale-said")).toMatchObject({ kind: "if", routes: { yes: "not-sale", no: "ready-said" } })
        const params = JSON.stringify((stepOf("not-sale-notice") as { params: unknown }).params)
        expect(params).toContain('"$ref":"trigger.data.conversationId"')
        expect(params).toContain('"$ref":"trigger.data.text"')
    })

    it("ends paid (after the after-sale is called with the order's id and code) or unpaid; a cancel keeps its road", () => {
        expect(salesConsultGraph.spec.outcomes.map((end) => end.key).toSorted()).toEqual(["closed", "declined", "not-sale", "paid", "quiet", "unpaid"])
        expect(stepOf("to-after-sale")).toMatchObject({ kind: "call-workflow", next: "paid" })
        const handed = JSON.stringify((stepOf("to-after-sale") as { params: unknown }).params)
        expect(handed).toContain("steps.create-order.output.orderId")
        expect(handed).toContain("steps.create-order.output.orderNo")
        expect(stepOf("cancel-said")).toMatchObject({ routes: { yes: "cancel-read", no: "quiet" } })
        expect(stepOf("cancel-paid")).toMatchObject({ routes: { yes: "cancel-paid-notice", no: "cancel-order" } })
        expect(stepOf("cancel-paid-notice")).toMatchObject({ step: "sales.cancel-paid-notice", next: "quiet" })
        expect(stepOf("cancel-order")).toMatchObject({ next: "cancel-request" })
        expect(stepOf("cancel-request")).toMatchObject({ step: "sales.request-cancel", next: "tell-cancelled" })
        expect(stepOf("tell-cancelled")).toMatchObject({ next: "quiet" })
    })
})

// R68: what the ENGINE tells the team, and where the run goes after, as each step declares it. One post per ending, as the notice nodes
// of v25-v29 posted one: the same endings, the same outcomes.
describe("sales.consult v30: the engine reports the unsuccessful endings (R68)", () => {
    const ORDER = { label: { vi: "Mã đơn", en: "Order" }, value: { $ref: "steps.create-order.output.orderNo", default: null } }
    const TOTAL = { label: { vi: "Tổng tiền", en: "Total" }, value: { $ref: "steps.create-order.output.amountVnd", default: null } }

    it.each([
        // A declined answer of the consult (was `declined-said` -> `consult-declined-notice` -> declined).
        ["consult", { then: "end", outcome: "declined", facts: [] }],
        // A declined order record: no order, the customer has no code (was `create-declined` -> notice -> declined).
        ["create-order", { then: "end", outcome: "declined", facts: [] }],
        // A declined order message (was `tell-declined` -> notice with the order's code -> declined).
        ["tell-order", { then: "end", outcome: "declined", facts: [ORDER] }],
        // A declined paid record (R41 Q8; was the `declined` leg of the pay `until`, `paid-declined` -> notice -> declined).
        ["paid-order", { then: "end", outcome: "declined", facts: [ORDER] }],
        // A declined cancel (was `cancel-declined` -> notice -> declined); the order's code now read from its record.
        ["cancel-order", { then: "end", outcome: "declined", facts: [{ label: ORDER.label, value: { $ref: "steps.cancel-read.output.orderNo", default: null } }] }],
        // A declined cancel message (was `tell-cancelled-declined` -> notice -> declined).
        ["tell-cancelled", { then: "end", outcome: "declined", facts: [{ label: ORDER.label, value: { $ref: "steps.cancel-order.output.orderNo", default: null } }] }],
        // The dates kept on the side: declined, the sale goes on (was `keep-occasions-declined` -> notice -> `not-sale-said`).
        ["keep-occasions", { then: "continue", facts: [] }],
        // An order answer or a reminder that did not reach the customer: the wait goes on (R45, R47; was `*-sent` -> unsent notice).
        ["order-talk", { then: "continue", facts: [ORDER] }],
        ["remind", { then: "continue", facts: [ORDER] }],
    ])("%s declares its ending", (key, unsuccessful) => {
        expect(stepOf(key)).toMatchObject({ unsuccessful })
    })

    it("the payment loop out of rounds tells the team the order and its total, then ends unpaid (R45; was `unpaid-notice`)", () => {
        expect(stepOf("pay")).toMatchObject({ routes: { exhausted: "unpaid" }, unsuccessful: { facts: [ORDER, TOTAL] } })
    })

    it("the talk loop running out ends quiet with NO notice (a customer going quiet is normal, R45)", () => {
        expect(stepOf("talk")).toMatchObject({ routes: { exhausted: "quiet" } })
        expect(stepOf("talk")).not.toHaveProperty("unsuccessful")
    })

    it("the steps the order's road reads past a declined record see the recorded order: the decline never goes on (the engine ends it)", () => {
        // The save check proves it (importing the graph compiled it): `request-pay` reads the order's code as a text, which the declined form has not.
        const declined = exampleOutput(salesOrderCreateNode.examples, (output) => output["declined"] === true)
        expect(declined["orderNo"]).toBeNull()
        expect(JSON.stringify((stepOf("request-pay") as { params: unknown }).params)).toContain("steps.create-order.output.orderNo")
    })
})

// The owner's target (R68): business steps and two loops; no edge branch may grow back silently.
describe("sales.consult v30: the business shape", () => {
    /**
     * The most steps the sale may hold (v30 had 35: v29 had 55; v31 adds the order's status check at a credit and at the timeout: 8 steps;
     * v32 adds the payment request's read at the wake and its withdrawal at a cancel: 2 steps; v33 adds the timeout test after a wake of
     * an order still waiting, so a write of the order reminds nobody: 1 step; v34 adds the payment wait's cancel road (CANCEL-GAP): the test of
     * the round's cancel wish, the cancel, its result, the request's withdrawal and the two words to the customer: 6 steps).
     */
    const STEPS_MAX = 52

    it("holds two until loops, two waits, two hand-backs and at most 52 steps", () => {
        expect(steps.filter((step) => step.kind === "loop").map((step) => step.key)).toEqual(["talk", "pay"])
        expect(steps.filter((step) => step.kind === "wait").map((step) => step.key)).toEqual(["hear", "await"])
        expect(steps.filter((step) => step.kind === "hand-back").map((step) => step.key)).toEqual(["give-back-talk", "give-back"])
        expect(steps.length).toBeLessThanOrEqual(STEPS_MAX)
    })

    it("draws no generic team notice and no condition on a step's declined or refused answer: the engine reports those", () => {
        expect(steps.filter((step) => step.kind === "node" && step.step.startsWith("team.")).map((step) => step.key)).toEqual([])
        const edgeTests = steps
            .filter((step) => step.kind === "if" || step.kind === "loop")
            .flatMap((step) => refsOf(step.params).map((ref) => `${step.key}<-${ref}`))
            .filter((read) => /\.output\.(declined|refusal|sent)$/u.test(read))
        expect(edgeTests).toEqual([])
    })

    it("names every condition, wait, loop, hand-back and outcome in both languages (the map never shows a generic word or a key)", () => {
        const unnamed = steps
            .filter((step) => step.kind === "if" || step.kind === "wait" || step.kind === "loop" || step.kind === "hand-back" || step.kind === "outcome")
            .filter((step) => !("label" in step) || step.label === undefined || !("vi" in step.label) || step.label.vi === "" || step.label.en === "")
            .map((step) => step.key)
        expect(unnamed).toEqual([])
        expect(salesConsultGraph.spec.outcomes.every((end) => end.title !== undefined)).toBe(true)
        expect(stepOf("pay")).toMatchObject({ exits: { until: { vi: "Thoát khi đơn đã trả, đã huỷ hoặc không còn chờ tiền" }, exhausted: { vi: "Hết 6 vòng mà chưa trả" } } })
        expect(stepOf("exact")).toMatchObject({ label: { vi: "Đủ tiền?" } })
    })
})

// MX-CORE DEF-2 / DEF-3 (P-FIX2, 2026-11-14): the `off` road on the matrix lines C-08 (round 1) and C-10 (round 3), run on the stored
// conditions with the consult's own outputs for exactly those two lines (the node's C-08 and C-10 examples), in the round each came in.
describe("sales.consult v30: the `off` road on the matrix lines C-08 (round 1) and C-10 (round 3)", () => {
    const named = (part: string): Record<string, JsonValue> => {
        const found = salesConsultTurnNode.examples.find((example) => example.name.includes(part))
        if (found === undefined || !("output" in found)) throw new Error(`no example ${part}`)
        return found.output as Record<string, JsonValue>
    }
    const firstOff = named("(MX-CORE C-08)")
    const laterOff = named("(MX-CORE C-10)")

    it("C-08, round 1: the consult's `off` ends the talk, `off-round` takes the notice (team told), and the run ends `not-sale`", () => {
        expect(firstOff).toMatchObject({ branch: "off", reply: null })
        expect(exprHolds(conditionOf("talk", "until"), readerOf({ steps: { consult: { output: firstOff } } }))).toBe(true)
        expect(exprHolds(conditionOf("off-round", "when"), readerOf({ item: { $round: 1 } }))).toBe(true)
        const told = exampleOutput(salesNotSaleNoticeNode.examples, (output) => output["posted"] === true)
        expect(exprHolds(conditionOf("not-sale-said", "when"), readerOf({ steps: { talk: { output: { rounds: 1, stopped: true, last: told } } } }))).toBe(true)
    })

    it("C-10, round 3: the consult's `off` (draft kept) does not end the talk; `off-round` hands the line back and the sale waits again", () => {
        expect(laterOff).toMatchObject({ branch: "off", reply: null, address: "25 Nguyen Hue" })
        expect(exprHolds(conditionOf("talk", "until"), readerOf({ steps: { consult: { output: laterOff }, hear: { output: { trigger: "said" } } } }))).toBe(false)
        expect(exprHolds(conditionOf("off-round", "when"), readerOf({ item: { $round: 3 } }))).toBe(false)
        // The next round's consult goes on from this draft (`round: "previous"`): the off turn carries the draft it was given.
        expect(laterOff["items"]).toEqual([expect.objectContaining({ quantity: 2 })])
    })
})

describe("sales.consult v30: the stored conditions against the outputs the nodes and the engine record", () => {
    const off = exampleOutput(salesConsultTurnNode.examples, (output) => output["branch"] === "off")
    const asked = exampleOutput(salesConsultTurnNode.examples, (output) => output["branch"] === "asked")
    const told = exampleOutput(salesNotSaleNoticeNode.examples, (output) => output["posted"] === true)
    const unposted = exampleOutput(salesNotSaleNoticeNode.examples, (output) => output["posted"] === false)
    /** The loop output of a talk that stopped after `rounds` rounds, its final round ended by the step that answered `last`. */
    const talk = (last: JsonValue, rounds = 1): JsonValue => ({ rounds, stopped: true, last })

    it("round 1 judged not about a sale: the talk ends, the round ended on the notice, and not-sale-said takes it to `not-sale`", () => {
        expect(exprHolds(conditionOf("talk", "until"), readerOf({ steps: { consult: { output: off } } }))).toBe(true)
        expect(exprHolds(conditionOf("not-sale-said", "when"), readerOf({ steps: { talk: { output: talk(told) } } }))).toBe(true)
        // A notice the team chat refused still ends the run `not-sale` (the refusal is in its output; the engine logs it, R45).
        expect(exprHolds(conditionOf("not-sale-said", "when"), readerOf({ steps: { talk: { output: talk(unposted) } } }))).toBe(true)
    })

    it("a talk that ended otherwise is no not-sale: the hear timeout, a consult that settled, or an if-step's own output", () => {
        const when = conditionOf("not-sale-said", "when")
        expect(exprHolds(when, readerOf({ steps: { talk: { output: talk({ trigger: "timeout" }, 3) } } }))).toBe(false)
        expect(exprHolds(when, readerOf({ steps: { talk: { output: talk({ ...asked, branch: "ready" }, 2) } } }))).toBe(false)
        expect(exprHolds(when, readerOf({ steps: { talk: { output: talk({ branch: "yes" }) } } }))).toBe(false)
    })

    it("a later round's `off` (a wait ran) and an `asked` turn do not end the talk; `ready`, `cancel` and the hear timeout do", () => {
        const until = conditionOf("talk", "until")
        const waited = { hear: { output: { trigger: "said" } } }
        expect(exprHolds(until, readerOf({ steps: { consult: { output: off }, ...waited } }))).toBe(false)
        expect(exprHolds(until, readerOf({ steps: { consult: { output: asked }, ...waited } }))).toBe(false)
        expect(exprHolds(until, readerOf({ steps: { consult: { output: { ...asked, branch: "ready" } }, ...waited } }))).toBe(true)
        expect(exprHolds(until, readerOf({ steps: { consult: { output: { ...asked, branch: "cancel" } }, ...waited } }))).toBe(true)
        expect(exprHolds(until, readerOf({ steps: { hear: { output: { trigger: "timeout" } } } }))).toBe(true)
    })

    it("the talk's last word routes the sale: ready records the order, cancel takes the cancel road, the rest ends quiet", () => {
        const last = (branch: string): ReturnType<typeof readerOf> => readerOf({ steps: { talk: { output: talk({ ...asked, branch }) } } })
        expect(exprHolds(conditionOf("ready-said", "when"), last("ready"))).toBe(true)
        expect(exprHolds(conditionOf("ready-said", "when"), last("cancel"))).toBe(false)
        expect(exprHolds(conditionOf("cancel-said", "when"), last("cancel"))).toBe(true)
        expect(exprHolds(conditionOf("cancel-said", "when"), last("asked"))).toBe(false)
    })

    it("a paid record (the paid step's real answer) ends the payment loop and goes on to the after-sale", () => {
        const paid = exampleOutput(salesOrderPaidNode.examples, (output) => output["declined"] === false)
        expect(exprHolds(conditionOf("pay", "until"), readerOf({ steps: { "paid-order": { output: paid } } }))).toBe(true)
        expect(exprHolds(conditionOf("pay", "until"), readerOf({ steps: {} }))).toBe(false)
    })

    it("a credit of the exact total records the order paid, another total takes the short road (the credit read's real answer)", () => {
        const credit = exampleOutput(salesCreditReadNode.examples, (output) => typeof output["amountVnd"] === "number")
        const amount = credit["amountVnd"]
        const order = (amountVnd: JsonValue): Record<string, JsonValue> => ({ "create-order": { output: { amountVnd } }, credit: { output: credit } })
        expect(exprHolds(conditionOf("exact", "when"), readerOf({ steps: order(amount ?? null) }))).toBe(true)
        expect(exprHolds(conditionOf("exact", "when"), readerOf({ steps: order(Number(amount) + 1000) }))).toBe(false)
    })

    it("a cancel of a paid order tells the team, of an unpaid one (the order read's real answers) cancels it", () => {
        const statuses = salesOrderReadNode.examples.flatMap((example) => ("output" in example ? [(example.output as Record<string, JsonValue>)["status"]] : []))
        expect(statuses.length).toBeGreaterThan(0)
        const when = conditionOf("cancel-paid", "when")
        expect(exprHolds(when, readerOf({ steps: { "cancel-read": { output: { status: "paid" } } } }))).toBe(true)
        for (const status of statuses.filter((one) => one !== "paid")) expect(exprHolds(when, readerOf({ steps: { "cancel-read": { output: { status } } } }))).toBe(false)
    })
})

// U-04 (E-FIX15, 2026-11-15): a credit settles only an order still waiting for money. Run on the stored conditions: the wait's route, the order's
// status as `order-now` read it, and the loop's way out.
describe("sales.consult v31: the payment wake reads the order as it stands now (U-04)", () => {
    const credit = exampleOutput(salesCreditReadNode.examples, (output) => typeof output["amountVnd"] === "number")
    const woke = (trigger: string, status: string | null): ReturnType<typeof readerOf> =>
        readerOf({ steps: { await: { output: { trigger } }, "order-now": { output: { status } }, credit: { output: credit } } })

    it("a wake reaches the order read first, whatever woke the wait", () => {
        expect(stepOf("order-now")).toMatchObject({ kind: "node", step: "sales.order-read", loop: "pay", next: "request-now" })
        expect(JSON.stringify((stepOf("order-now") as { params: unknown }).params)).toContain("steps.create-order.output.orderId")
        expect(stepOf("awaiting")).toMatchObject({ kind: "if", routes: { yes: "closed-credit", no: "credit-woke" } })
    })

    it("a CANCELLED order: the credit takes the stranger road (read, then the team notice) and never `credit` / `paid-order`", () => {
        const awaiting = conditionOf("awaiting", "when")
        for (const status of ["cancelled", "paid", "draft", "failed_system"]) expect(exprHolds(awaiting, woke("credit", status))).toBe(true)
        expect(exprHolds(conditionOf("closed-credit", "when"), woke("credit", "cancelled"))).toBe(true)
        expect(stepOf("closed-credit")).toMatchObject({ routes: { yes: "stranger-read" } })
        expect(stepOf("stranger-read")).toMatchObject({ kind: "node", step: "sales.credit-read", next: "stranger-notice" })
        expect(stepOf("stranger-notice")).toMatchObject({ kind: "node", step: "sales.credit-notice", loop: "pay" })
        const noticed = JSON.stringify((stepOf("stranger-notice") as { params: unknown }).params)
        for (const member of ["transactionId", "amountVnd", "content"]) expect(noticed).toContain(`steps.stranger-read.output.${member}`)
        expect(stepOf("stranger-notice")).not.toHaveProperty("unsuccessful")
    })

    it("an order still waiting (`confirmed` / `invoiced`) goes on: a credit to `credit`, the timeout to `remind`", () => {
        const awaiting = conditionOf("awaiting", "when")
        for (const status of ["confirmed", "invoiced"]) expect(exprHolds(awaiting, woke("credit", status))).toBe(false)
        expect(exprHolds(conditionOf("credit-woke", "when"), woke("credit", "confirmed"))).toBe(true)
        expect(exprHolds(conditionOf("credit-woke", "when"), woke("timeout", "confirmed"))).toBe(false)
        expect(stepOf("credit-woke")).toMatchObject({ routes: { yes: "credit", no: "late-woke" } })
        expect(exprHolds(conditionOf("late-woke", "when"), woke("timeout", "confirmed"))).toBe(true)
        expect(stepOf("late-woke")).toMatchObject({ kind: "if", loop: "pay", routes: { yes: "remind" } })
    })

    it("a closed order: the timeout sends no reminder (the round just ends and the loop leaves); a message never goes through the read", () => {
        expect(exprHolds(conditionOf("closed-credit", "when"), woke("timeout", "cancelled"))).toBe(false)
        // The round's end is the engine's own mark, so the `no` route is not written.
        expect((stepOf("closed-credit") as { routes: Record<string, string> }).routes).toEqual({ yes: "stranger-read" })
        expect(stepOf("give-back")).toMatchObject({ kind: "hand-back", loop: "pay" })
    })

    it("the loop leaves when the order is paid OR no longer waits; `settled` sends only a recorded payment to the after-sale, else the run ends `closed`", () => {
        const until = conditionOf("pay", "until")
        expect(exprHolds(until, woke("credit", "cancelled"))).toBe(true)
        expect(exprHolds(until, woke("timeout", "confirmed"))).toBe(false)
        expect(exprHolds(until, readerOf({ steps: {} }))).toBe(false)
        const paid = exampleOutput(salesOrderPaidNode.examples, (output) => output["declined"] === false)
        const loop = (last: JsonValue): ReturnType<typeof readerOf> => readerOf({ steps: { pay: { output: { rounds: 1, stopped: true, last } } } })
        expect(exprHolds(conditionOf("settled", "when"), loop(paid))).toBe(true)
        expect(exprHolds(conditionOf("settled", "when"), loop({ posted: true, refusal: null }))).toBe(false)
        expect(stepOf("settled")).toMatchObject({ routes: { yes: "to-after-sale", no: "closed" } })
        expect(stepOf("closed")).toMatchObject({ kind: "outcome" })
    })
})

// S7-WAIT (concept templates rule 12, agent-data rule 2): a wait KEY is one meaning listing its verbs. The person's line on any channel is ONE
// key `said`; a write of THIS order (the order type declares its writes as events keyed by the order) is the key `ordered`, routed through
// the same read as a credit and the timeout: a workbench cancel ends the run `closed` with no reminder and no thank-you.
describe("sales.consult v33: one meaning per key; the order's own write wakes the payment wait", () => {
    const credit = exampleOutput(salesCreditReadNode.examples, (output) => typeof output["amountVnd"] === "number")
    const woke = (trigger: string, status: string | null): ReturnType<typeof readerOf> =>
        readerOf({ steps: { await: { output: { trigger } }, "order-now": { output: { status } }, credit: { output: credit } } })
    const keysOf = (key: string): ReadonlyArray<{ readonly key: string; readonly verbs: ReadonlyArray<string> }> =>
        (stepOf(key) as unknown as { params: { on: ReadonlyArray<{ key: string; verbs: ReadonlyArray<string> }> } }).params.on

    it("both waits hear the person through ONE key listing the four channel verbs", () => {
        const channels = [TRIGGER.zaloMessageReceived, TRIGGER.telegramMessageReceived, TRIGGER.facebookMessageReceived, TRIGGER.instagramMessageReceived]
        expect(keysOf("hear")).toEqual([{ key: "said", verbs: channels }])
        expect(keysOf("await").map((one) => one.key)).toEqual(["credit", "said", "ordered"])
        expect(keysOf("await").find((one) => one.key === "said")?.verbs).toEqual(channels)
    })

    it("`ordered` listens for a write of the ORDER type matched on this run's order id, and the order type declares its writes as events", () => {
        expect(keysOf("await").find((one) => one.key === "ordered")).toEqual({
            key: "ordered",
            verbs: [TRIGGER.recordWritten],
            where: [{ param: "data.type", op: "equals", value: orderEntity.name }],
            match: [{ member: "data.recordId", op: "eq", value: { $ref: "steps.create-order.output.orderId", default: null } }],
        })
        expect(orderEntity.name).toBe("blocks-core.sales.order")
        expect(orderEntity.events).toEqual({ subject: "id", combine: "latest", members: ["status"] })
    })

    it("a workbench CANCEL (`ordered`, the order no longer waiting): no reminder, no credit road, the loop leaves, the run ends `closed`", () => {
        expect(exprHolds(conditionOf("awaiting", "when"), woke("ordered", "cancelled"))).toBe(true)
        expect(exprHolds(conditionOf("closed-credit", "when"), woke("ordered", "cancelled"))).toBe(false)
        expect(exprHolds(conditionOf("pay", "until"), woke("ordered", "cancelled"))).toBe(true)
        const loop = readerOf({ steps: { pay: { output: { rounds: 1, stopped: true, last: { trigger: "ordered" } } } } })
        expect(exprHolds(conditionOf("settled", "when"), loop)).toBe(false)
        expect(stepOf("settled")).toMatchObject({ routes: { no: "closed" } })
    })

    it("a write of an order STILL waiting (`confirmed` / `invoiced`): neither the credit road nor a reminder; the wait goes on", () => {
        for (const status of ["confirmed", "invoiced"]) {
            expect(exprHolds(conditionOf("awaiting", "when"), woke("ordered", status))).toBe(false)
            expect(exprHolds(conditionOf("credit-woke", "when"), woke("ordered", status))).toBe(false)
            expect(exprHolds(conditionOf("late-woke", "when"), woke("ordered", status))).toBe(false)
            expect(exprHolds(conditionOf("pay", "until"), woke("ordered", status))).toBe(false)
        }
    })
})

// R111 (PAY-REQ, 2026-11-15): ONE payment request, whichever money provider the account is. The node holds no provider branch; the wait matches
// the request's own key; every wake reads the request too (a payer cancelling at checkout or a request lapsing sends no event). Run on the
// stored conditions with the nodes' OWN example outputs: a payOS account (a request kept) and a SePay account (none kept), through the same steps.
describe("sales.consult v32: the payment request (R111)", () => {
    const payos = exampleOutput(salesRequestPayNode.examples, (output) => output["requestRef"] !== null)
    const sepay = exampleOutput(salesRequestPayNode.examples, (output) => output["requestRef"] === null)
    const read = (status: string | null): Record<string, JsonValue> => exampleOutput(salesRequestReadNode.examples, (output) => output["status"] === status)
    const woke = (trigger: string, status: string, request: Record<string, JsonValue>): ReturnType<typeof readerOf> =>
        readerOf({ steps: { await: { output: { trigger } }, "order-now": { output: { status } }, "request-now": { output: request } } })

    it("the same request step serves a payOS and a SePay account: one node, one tool, the accounts listed [payos, sepay]", () => {
        expect(stepOf("request-pay")).toMatchObject({ kind: "node", step: "sales.request-pay" })
        expect(salesRequestPayNode.accounts).toEqual(["payos", "sepay"])
        expect(payos).toMatchObject({ payUrl: expect.any(String), qrImageUrl: null, payKey: payos["requestRef"] })
        expect(sepay).toMatchObject({ payUrl: null, qrImageUrl: expect.any(String), requestRef: null, payKey: sepay["transferContent"] })
        expect(JSON.stringify((stepOf("tell-order") as { params: unknown }).params)).toContain("steps.request-pay.output")
    })

    it("a credit is matched by the request's own key (the provider's request reference, or the transfer content for a provider that keeps none), never by a text the graph picks", () => {
        const awaited = JSON.stringify(stepOf("await"))
        expect(awaited).toContain('"member":"data.payKey"')
        expect(awaited).toContain("steps.request-pay.output.payKey")
        expect(awaited).not.toContain('"member":"data.content"')
    })

    it("every wake reads the request after the order (nothing called when the order keeps none): request-now -> awaiting", () => {
        expect(stepOf("request-now")).toMatchObject({ kind: "node", step: "sales.request-read", loop: "pay", next: "awaiting" })
        expect(JSON.stringify((stepOf("request-now") as { params: unknown }).params)).toContain("steps.order-now.output.paymentRequestRef")
        expect(read(null)).toEqual({ status: null })
    })

    it("a request cancelled at checkout (PAYOS-9) or expired (PAYOS-10) ends the wait like a closed order: the timeout sends no reminder, a credit is a stranger credit, the run ends closed", () => {
        const awaiting = conditionOf("awaiting", "when")
        const until = conditionOf("pay", "until")
        for (const status of ["cancelled", "expired"]) {
            expect(exprHolds(awaiting, woke("timeout", "confirmed", read(status)))).toBe(true)
            expect(exprHolds(awaiting, woke("credit", "confirmed", read(status)))).toBe(true)
            expect(exprHolds(until, woke("timeout", "confirmed", read(status)))).toBe(true)
            expect(exprHolds(conditionOf("closed-credit", "when"), woke("credit", "confirmed", read(status)))).toBe(true)
        }
        const loop = readerOf({ steps: { pay: { output: { rounds: 1, stopped: true, last: { status: "cancelled" } } } } })
        expect(exprHolds(conditionOf("settled", "when"), loop)).toBe(false)
    })

    it("an open request (payOS) or no request (SePay) keeps waiting: a credit goes on to be read and settled, the timeout reminds", () => {
        const awaiting = conditionOf("awaiting", "when")
        for (const request of [read("open"), read(null)]) {
            expect(exprHolds(awaiting, woke("credit", "confirmed", request))).toBe(false)
            expect(exprHolds(conditionOf("pay", "until"), woke("timeout", "confirmed", request))).toBe(false)
            expect(exprHolds(conditionOf("credit-woke", "when"), woke("credit", "confirmed", request))).toBe(true)
        }
    })

    it("a credit for a closed order is still the stranger road, whatever the request says (the order's status first)", () => {
        expect(exprHolds(conditionOf("awaiting", "when"), woke("credit", "cancelled", read("open")))).toBe(true)
        expect(exprHolds(conditionOf("awaiting", "when"), woke("credit", "paid", read(null)))).toBe(true)
    })

    it("a cancelled order withdraws its request while it is open, and touches nothing when it keeps none", () => {
        expect(JSON.stringify((stepOf("cancel-request") as { params: unknown }).params)).toContain("steps.cancel-read.output.paymentRequestRef")
        const outputs = salesRequestCancelNode.examples.flatMap((example) => ("output" in example ? [example.output] : []))
        expect(outputs).toEqual(expect.arrayContaining([{ withdrawn: true, status: "cancelled" }, { withdrawn: false, status: null }]))
    })
})

// CANCEL-GAP (2026-11-15, production run 5704ee0e): the customer asked three times to cancel the order while the sale waited for the money;
// `order-talk` knew only `about` (answer in words) and `off`, so each wish was answered `about` with words promising a hand-off to the owner,
// the round ended and the cancel road stayed unreached. Nature: a step tells a person only what its declared outcome makes the run do; a
// wish the workflow must act on is an OUTCOME of the step with a road, never words. A round of the payment loop is walked here on the
// compiled graph with the nodes' OWN example outputs standing in for the model's fixed answers (the examples run in the node specs).
describe("sales.consult v34: a wish to cancel during the payment wait takes the cancel road (CANCEL-GAP)", () => {
    type Outputs = Readonly<Record<string, Record<string, JsonValue>>>
    const wish = exampleOutput(salesOrderTalkNode.examples, (output) => output["topic"] === "cancel")
    const answered = exampleOutput(salesOrderTalkNode.examples, (output) => output["topic"] === "about")
    const cancelled = exampleOutput(salesOrderCancelNode.examples, (output) => output["declined"] === false)
    const declined = exampleOutput(salesOrderCancelNode.examples, (output) => output["declined"] === true)
    const withdrawn = exampleOutput(salesRequestCancelNode.examples, (output) => output["withdrawn"] === true)
    const told = exampleOutput(salesOrderCancelTellNode.examples, (output) => output["declined"] === false)
    const waiting = { status: "confirmed", orderId: "o7", orderNo: "DH-7", paymentRequestRef: "1789000000001" }
    const open = { status: "open" }

    /**
     * One round of the payment loop as the engine walks it: from the wait's route, each if-step by its stored condition, each node by its
     * declared route member (none written: the round ends) or its `next`; a hand-back ends the round. Answers the steps walked and the scope.
     */
    const round = (trigger: string, outputs: Outputs, before: Outputs = {}): { readonly path: ReadonlyArray<string>; readonly scope: Record<string, JsonValue> } => {
        const scope: Record<string, { output: JsonValue }> = { await: { output: { trigger } } }
        for (const [key, output] of Object.entries(before)) scope[key] = { output }
        const read = (): ReturnType<typeof readerOf> => readerOf({ steps: scope as unknown as JsonValue })
        const path: Array<string> = []
        let at: string | undefined = (stepOf("await") as unknown as { routes: Record<string, string> }).routes[trigger]
        while (at !== undefined) {
            path.push(at)
            const step = stepOf(at) as unknown as { kind: string; routes?: Record<string, string>; routeBy?: string; next?: string; params: Record<string, StoredExpr> }
            if (step.kind === "if") at = step.routes?.[exprHolds(step.params["when"] as StoredExpr, read()) ? "yes" : "no"]
            else if (step.kind === "node") {
                const output = outputs[at]
                if (output === undefined) throw new Error(`the walk reached ${at} with no output scripted`)
                scope[at] = { output }
                at = step.routeBy === undefined ? step.next : step.routes?.[String(output[step.routeBy])]
            } else at = undefined
        }
        return { path, scope: scope as unknown as Record<string, JsonValue> }
    }
    const leaves = (scope: Record<string, JsonValue>): boolean => exprHolds(conditionOf("pay", "until"), readerOf({ steps: scope as JsonValue }))

    it("the order talk declares the outcome `cancel` with its road: the order and its request are read as they stand now", () => {
        expect(salesOrderTalkNode.routes).toEqual({ by: "topic", names: ["about", "cancel", "off"] })
        expect(wish).toEqual({ topic: "cancel", sent: false, refusal: null, cancelReason: expect.any(String) })
        expect((stepOf("order-talk") as unknown as { routes: Record<string, string> }).routes).toEqual({ off: "give-back", cancel: "order-now" })
    })

    it("the case: a wish to cancel an order still waiting reaches the cancel, withdraws the open request, tells the customer and leaves the loop `closed`", () => {
        const walked = round("said", { "order-talk": wish, "order-now": waiting, "request-now": open, "pay-cancel-order": cancelled, "pay-cancel-request": withdrawn, "pay-tell-cancelled": told })
        expect(walked.path).toEqual(["order-talk", "order-now", "request-now", "awaiting", "credit-woke", "late-woke", "pay-cancel-asked", "pay-cancel-order", "pay-cancelled", "pay-cancel-request", "pay-tell-cancelled"])
        expect(leaves(walked.scope)).toBe(true)
        // The loop's last word is the customer's message, which names no order paid: `settled` ends the run `closed`, no after-sale.
        expect(exprHolds(conditionOf("settled", "when"), readerOf({ steps: { pay: { output: { rounds: 1, stopped: true, last: told } } } }))).toBe(false)
        const wired = JSON.stringify((stepOf("pay-cancel-request") as { params: unknown }).params)
        expect(wired).toContain("steps.order-now.output.paymentRequestRef")
        expect(JSON.stringify((stepOf("pay-cancel-order") as { params: unknown }).params)).toContain("steps.order-talk.output.cancelReason")
    })

    it("a person declines the cancel: the engine tells the team (the step's ending), the customer is told the order stays, the wait goes on", () => {
        expect(stepOf("pay-cancel-order")).toMatchObject({ unsuccessful: { then: "continue" } })
        const walked = round("said", { "order-talk": wish, "order-now": waiting, "request-now": open, "pay-cancel-order": declined, "pay-tell-kept": told })
        expect(walked.path).toEqual(["order-talk", "order-now", "request-now", "awaiting", "credit-woke", "late-woke", "pay-cancel-asked", "pay-cancel-order", "pay-cancelled", "pay-tell-kept"])
        expect(walked.path).not.toContain("pay-cancel-request")
        expect(leaves(walked.scope)).toBe(false)
        expect(JSON.stringify((stepOf("pay-tell-kept") as { params: unknown }).params)).toContain('"cancelled":false')
        expect(JSON.stringify((stepOf("pay-tell-cancelled") as { params: unknown }).params)).toContain('"cancelled":true')
    })

    it("production's rounds as recorded (`about` every time) end the round in words and never leave: the gap v34 closes is the missing outcome", () => {
        const walked = round("said", { "order-talk": answered })
        expect(walked.path).toEqual(["order-talk"])
        expect(leaves(walked.scope)).toBe(false)
    })

    it("a wish to cancel an order that no longer waits takes the read's own road: no cancel, the loop leaves `closed`", () => {
        const walked = round("said", { "order-talk": wish, "order-now": { ...waiting, status: "cancelled" }, "request-now": open })
        expect(walked.path).toEqual(["order-talk", "order-now", "request-now", "awaiting", "closed-credit"])
        expect(leaves(walked.scope)).toBe(true)
    })

    it("a later round woken by a write of the order or the timeout never re-runs an earlier round's cancel wish", () => {
        const earlier = { "order-talk": wish, "pay-cancel-order": declined }
        const ordered = round("ordered", { "order-now": waiting, "request-now": open }, earlier)
        expect(ordered.path).toEqual(["order-now", "request-now", "awaiting", "credit-woke", "late-woke", "pay-cancel-asked"])
        expect(leaves(ordered.scope)).toBe(false)
    })

    it("the cancel steps of both roads are the same nodes; the talk loop's road tells the customer the order is cancelled", () => {
        expect(stepOf("pay-cancel-order")).toMatchObject({ kind: "node", step: "sales.order-cancel", loop: "pay" })
        expect(stepOf("pay-cancel-request")).toMatchObject({ kind: "node", step: "sales.request-cancel", loop: "pay" })
        expect(stepOf("pay-tell-cancelled")).toMatchObject({ kind: "node", step: "sales.order-cancel-tell", loop: "pay" })
        expect(stepOf("pay-tell-kept")).toMatchObject({ kind: "node", step: "sales.order-cancel-tell", loop: "pay" })
        expect(JSON.stringify((stepOf("tell-cancelled") as { params: unknown }).params)).toContain('"cancelled":true')
    })
})
