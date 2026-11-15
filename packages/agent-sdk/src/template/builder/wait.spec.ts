import { z } from "zod"
import { graphSpecV2Schema, graphSpecV2WrittenSchema } from "../../graph/graph-spec-v2.schema"
import type { GraphSpecV2, GraphV2Step } from "../../graph/graph-spec-v2.types"
import { PROVIDER, TRIGGER } from "../../names"
import { endRound, equals, handBack, ifNode, loop, memberContains, memberEquals, node, outcome, ref, round, trigger, wait, waitFor } from "./graph-builder"
import type { GraphStep, TemplateGraphConfig } from "./graph-builder.types"
import { compileTemplateGraph, waitTimeoutOf } from "./graph-compile"
import { templateGraphProblems } from "./graph-problems"
import { defineTemplateNode } from "./template-node"
import type { TemplateProblem } from "./template-problems"
import { openToolLookup, exampleTriggerLookup, listOrders, remindNote } from "./template.fixture"

// `wait({ for, timeout, next })`: a step that waits on the SAME run for one of several triggers, or a timeout, and routes on which came.

const codesOf = (problems: ReadonlyArray<TemplateProblem>): ReadonlyArray<string> => problems.map((one) => `${one.code}@${one.at}`)

/** Reads the event a wait answered: a member of a key's event, and the key itself. */
const readEvent = defineTemplateNode({
    id: "test.read-event",
    title: { key: "t" },
    description: { vi: "N\u00fat th\u1eed nghi\u1ec7m c\u1ee7a b\u1ed9 ki\u1ec3m tra.", en: "A test node of the checks." },
    tools: [],
    mode: "auto",
    accounts: [],
    input: z.object({ text: z.string().max(200), came: z.string().max(200) }),
    output: z.object({ text: z.string().max(200) }),
    run: (input) => Promise.resolve({ text: input.text }),
    examples: [{ name: "x", params: {}, input: { text: "a", came: "replied" }, output: { text: "a" } }],
})

/** A graph that lists the orders, then waits for a customer line or a clock tick, two hours at most. */
const waitConfig = (step: GraphStep, after: Readonly<Record<string, GraphStep>> = {}): TemplateGraphConfig => ({
    key: "test.wait",
    title: { key: "g" },
    input: z.object({ code: z.string().max(200) }),
    triggers: [trigger(TRIGGER.workflowCalled)],
    start: "list",
    nodes: {
        list: node(listOrders, { next: "hold" }),
        hold: step,
        read: node(readEvent, { input: { text: ref("steps.hold.output.event.text"), came: ref("steps.hold.output.trigger") }, next: "done" }),
        tick: node(remindNote, { input: { orderId: "o" }, next: "done" }),
        late: node(remindNote, { input: { orderId: "late" }, next: "done" }),
        done: outcome({ name: "done" }),
        ...after,
    },
})

const twoWay = wait({
    for: {
        replied: waitFor(TRIGGER.zaloMessageReceived, { match: [memberContains("text", ref("trigger.code"))] }),
        ticked: waitFor(TRIGGER.clockTick),
    },
    timeout: "2h",
    next: { replied: "read", ticked: "tick", timeout: "late" },
})

const context = { nodes: new Map(), tools: openToolLookup, triggers: exampleTriggerLookup, nullability: "strict" as const }

const problemsOf = (config: TemplateGraphConfig): ReadonlyArray<string> => {
    const compiled = compileTemplateGraph(config)
    return codesOf([...compiled.problems, ...templateGraphProblems(compiled.graph.spec, { ...context, nodes: compiled.graph.nodes })])
}

const waitStepOf = (spec: GraphSpecV2): GraphV2Step | undefined => spec.nodes.find((step) => step.kind === "wait")

describe("wait: the builder and the stored form", () => {
    it("compiles to `core.wait`: the triggers in written order, the timeout as one unit, one route per key and timeout", () => {
        const compiled = compileTemplateGraph(waitConfig(twoWay))
        expect(waitStepOf(compiled.graph.spec)).toEqual({
            kind: "wait",
            key: "hold",
            step: "core.wait",
            params: {
                on: [
                    {
                        key: "replied",
                        verbs: [TRIGGER.zaloMessageReceived],
                        match: [
                            { member: "text", op: "contains", value: { $ref: "trigger.code", default: null } },
                        ],
                    },
                    { key: "ticked", verbs: [TRIGGER.clockTick] },
                ],
                timeout: { hours: 2 },
            },
            routes: { replied: "read", ticked: "tick", timeout: "late" },
        })
    })

    it("the written and the read @2 schema take it as written", () => {
        const spec = compileTemplateGraph(waitConfig(twoWay)).graph.spec
        expect(graphSpecV2WrittenSchema.parse(spec)).toEqual(spec)
        expect(graphSpecV2Schema.parse(spec)).toEqual(spec)
    })

    it("reads a timeout text in minutes, hours or days", () => {
        expect([waitTimeoutOf("30m"), waitTimeoutOf("2h"), waitTimeoutOf("3d"), waitTimeoutOf({ minutes: 5 })]).toEqual([
            { minutes: 30 },
            { hours: 2 },
            { days: 3 },
            { minutes: 5 },
        ])
    })

    it("a sound wait saves clean; a step on a key's route reads that key's event (the union narrows on `trigger`)", () => {
        expect(problemsOf(waitConfig(twoWay))).toEqual([])
    })
})

// Concept templates rule 12 (S7-WAIT): a KEY is ONE meaning with one route; it lists the verbs that bring that meaning. A person's line on
// any channel is one meaning (the case); the second kind is a record-keyed meaning (a record write of a type, no person) beside a clock.
describe("wait: a key is one meaning listing its verbs", () => {
    // The compile already runs the save checks, and `problemsOf` runs them again: each problem is counted once.
    const waitCodes = (config: TemplateGraphConfig): ReadonlyArray<string> => [...new Set(problemsOf(config).filter((code) => code.startsWith("WAIT_")))]
    const said = waitFor([TRIGGER.zaloMessageReceived, TRIGGER.telegramMessageReceived, TRIGGER.facebookMessageReceived, TRIGGER.instagramMessageReceived])
    const chat = wait({ for: { said, ticked: waitFor(TRIGGER.clockTick) }, timeout: "1d", next: { said: "read", ticked: "tick", timeout: "late" } })

    it("one key, four channel verbs, one route: stored as the key's verb list in written order", () => {
        const step = waitStepOf(compileTemplateGraph(waitConfig(chat)).graph.spec)
        expect(step).toMatchObject({
            params: {
                on: [
                    {
                        key: "said",
                        verbs: [TRIGGER.zaloMessageReceived, TRIGGER.telegramMessageReceived, TRIGGER.facebookMessageReceived, TRIGGER.instagramMessageReceived],
                    },
                    { key: "ticked", verbs: [TRIGGER.clockTick] },
                ],
            },
            routes: { said: "read", ticked: "tick", timeout: "late" },
        })
        const spec = compileTemplateGraph(waitConfig(chat)).graph.spec
        expect(graphSpecV2Schema.parse(spec)).toEqual(spec)
        // The step on the key's route reads the key's event: the union of its verbs' events (the Zalo line supplies `text`).
        expect(problemsOf(waitConfig(chat))).toEqual([])
    })

    it("the second kind: a record write of a type (matched on the record's id), a person's line and the clock: three meanings, three keys", () => {
        const record = wait({
            for: {
                ordered: waitFor(TRIGGER.recordWritten, {
                    where: [{ param: "data.type", op: "equals", value: "fixture.renewal-request" }],
                    match: [memberEquals("data.recordId", ref("trigger.code"))],
                }),
                said: waitFor([TRIGGER.zaloMessageReceived, TRIGGER.telegramMessageReceived]),
                ticked: waitFor(TRIGGER.clockTick),
            },
            timeout: "1d",
            next: { ordered: "tick", said: "read", ticked: "tick", timeout: "late" },
        })
        const step = waitStepOf(compileTemplateGraph(waitConfig(record)).graph.spec)
        expect(step).toMatchObject({
            params: {
                on: [
                    {
                        key: "ordered",
                        verbs: [TRIGGER.recordWritten],
                        where: [{ param: "data.type", op: "equals", value: "fixture.renewal-request" }],
                        match: [{ member: "data.recordId", op: "eq", value: { $ref: "trigger.code", default: null } }],
                    },
                    { key: "said", verbs: [TRIGGER.zaloMessageReceived, TRIGGER.telegramMessageReceived] },
                    { key: "ticked", verbs: [TRIGGER.clockTick] },
                ],
            },
        })
        expect(waitCodes(waitConfig(record))).toEqual([])
    })

    it("a verb listed under two keys (or twice under one) is refused: an event of it would have two meanings", () => {
        const twice = wait({
            for: { said, again: waitFor([TRIGGER.clockTick, TRIGGER.telegramMessageReceived]) },
            timeout: "1h",
            next: { said: "read", again: "tick", timeout: "late" },
        })
        expect(waitCodes(waitConfig(twice))).toEqual([
            `WAIT_VERB_DUPLICATE@nodes.hold.params.on.again.${TRIGGER.telegramMessageReceived}`,
        ])
        const inOne = wait({ for: { ticked: waitFor([TRIGGER.clockTick, TRIGGER.clockTick]) }, timeout: "1h", next: { ticked: "tick", timeout: "late" } })
        expect(waitCodes(waitConfig(inOne))).toEqual([`WAIT_VERB_DUPLICATE@nodes.hold.params.on.ticked.${TRIGGER.clockTick}`])
    })

    it("a key that lists no verb is refused (a raw document; the builder takes a non-empty list)", () => {
        const spec = compileTemplateGraph(waitConfig(twoWay)).graph.spec
        const nodes = spec.nodes.map((step): GraphV2Step =>
            step.kind === "wait" ? { ...step, params: { ...step.params, on: [step.params.on[0], { key: "ticked", verbs: [] }] } } : step,
        )
        expect(codesOf(templateGraphProblems({ ...spec, nodes }, context)).filter((code) => code.startsWith("WAIT_"))).toEqual([
            "WAIT_VERBS_EMPTY@nodes.hold.params.on.ticked",
        ])
    })

    it("the bound of 5 counts KEYS (meanings), never verbs: one key of four channels and four more keys save; a sixth key does not", () => {
        const five = wait({
            for: {
                said,
                ticked: waitFor(TRIGGER.clockTick),
                paid: waitFor(TRIGGER.paymentCreditReceived),
                mailed: waitFor(TRIGGER.mailMessageReceived),
                ordered: waitFor(TRIGGER.recordWritten),
            },
            timeout: "1h",
            next: { said: "read", ticked: "tick", paid: "tick", mailed: "tick", ordered: "tick", timeout: "late" },
        })
        expect(waitCodes(waitConfig(five))).toEqual([])
        const six = wait({
            for: { ...five.on, called: waitFor(TRIGGER.workflowCalled) },
            timeout: "1h",
            next: { ...five.next, called: "tick" },
        })
        expect(waitCodes(waitConfig(six))).toEqual(["WAIT_TRIGGERS_TOO_MANY@nodes.hold.params.on"])
    })
})

describe("wait: the save problems", () => {
    it.each<readonly [string, GraphStep, ReadonlyArray<string>]>([
        [
            "no trigger",
            wait({ for: {}, timeout: "1h", next: { timeout: "late" } }),
            ["WAIT_TRIGGERS_EMPTY@nodes.hold.params.on"],
        ],
        [
            "a key named timeout",
            wait({ for: { timeout: waitFor(TRIGGER.clockTick) }, timeout: "1h", next: { timeout: "late" } }),
            ["WAIT_KEY_INVALID@nodes.hold.params.on.timeout"],
        ],
        [
            "a timeout out of bounds",
            wait({ for: { ticked: waitFor(TRIGGER.clockTick) }, timeout: "31d", next: { ticked: "tick", timeout: "late" } }),
            ["WAIT_TIMEOUT_INVALID@nodes.hold.params.timeout"],
        ],
        [
            "a verb the agent's accounts cannot serve",
            wait({ for: { paid: waitFor(TRIGGER.paymentCreditReceived) }, timeout: "1h", next: { paid: "tick", timeout: "late" } }),
            [`WAIT_TRIGGER_UNSERVED@nodes.hold.params.on.paid.${TRIGGER.paymentCreditReceived}`],
        ],
    ])("%s", (_name, step, codes) => {
        const config = { ...waitConfig(step), nodes: { ...waitConfig(step).nodes, read: node(remindNote, { input: { orderId: "o" }, next: "done" }) } }
        const compiled = compileTemplateGraph(config)
        const all = codesOf(
            templateGraphProblems(compiled.graph.spec, { ...context, nodes: compiled.graph.nodes, agentAccounts: [PROVIDER.zaloOa] }),
        )
        expect(all.filter((code) => code.startsWith("WAIT_"))).toEqual(codes)
    })

    it("a raw document: a key twice, a key with no route, a route of no key", () => {
        const spec = compileTemplateGraph(waitConfig(twoWay)).graph.spec
        const nodes = spec.nodes.map((step): GraphV2Step =>
            step.kind === "wait"
                ? {
                      ...step,
                      params: { ...step.params, on: [step.params.on[0], { key: "replied", verbs: [TRIGGER.clockTick] }] },
                      routes: { replied: "read", stray: "tick" },
                  }
                : step,
        )
        const codes = codesOf(templateGraphProblems({ ...spec, nodes: [nodes[0] ?? spec.nodes[0], ...nodes.slice(1)] }, context))
        expect(codes).toEqual(
            expect.arrayContaining([
                "WAIT_KEY_DUPLICATE@nodes.hold.params.on.replied",
                "WAIT_ROUTE_MISSING@nodes.hold.routes.timeout",
                "WAIT_ROUTE_UNKNOWN@nodes.hold.routes.stray",
            ]),
        )
    })

    it("a ref to a member the waited event does not supply is a GRAPH_REF_TYPE", () => {
        const config = waitConfig(twoWay, {
            read: node(readEvent, {
                input: { text: ref("steps.hold.output.event.nothing"), came: ref("steps.hold.output.trigger") },
                next: "done",
            }),
        })
        expect(problemsOf(config).some((code) => code.startsWith("GRAPH_REF_TYPE@nodes.read"))).toBe(true)
    })
})

describe("handBack: the event a wait took goes on to whoever else waits for it (R11)", () => {
    // The compile already runs the save checks, and `problemsOf` runs them again: each problem is counted once.
    const filtered = (config: TemplateGraphConfig, prefix: string): ReadonlyArray<string> => [
        ...new Set(problemsOf(config).filter((code) => code.startsWith(prefix))),
    ]
    const withGive = (next: Readonly<Record<"replied" | "ticked" | "timeout", string>>, give: GraphStep): TemplateGraphConfig =>
        waitConfig(wait({ for: { replied: waitFor(TRIGGER.zaloMessageReceived), ticked: waitFor(TRIGGER.clockTick) }, timeout: "2h", next }), {
            give,
        })

    it("compiles to `core.hand-back` with the wait's key; on a trigger route of the wait it holds", () => {
        const config = withGive({ replied: "give", ticked: "tick", timeout: "late" }, handBack({ wait: "hold", next: "done" }))
        const spec = compileTemplateGraph(config).graph.spec
        expect(spec.nodes.find((step) => step.key === "give")).toEqual({
            kind: "hand-back",
            key: "give",
            step: "core.hand-back",
            params: { wait: "hold" },
            next: "done",
        })
        expect(graphSpecV2Schema.safeParse(spec).success).toBe(true)
        expect(filtered(config, "GRAPH_HAND_BACK")).toEqual([])
    })

    it("is refused on the timeout route (no event came) and when the step it names is no wait", () => {
        const onTimeout = withGive({ replied: "read", ticked: "tick", timeout: "give" }, handBack({ wait: "hold", next: "done" }))
        expect(filtered(onTimeout, "GRAPH_HAND_BACK")).toEqual(["GRAPH_HAND_BACK_NO_EVENT@nodes.give.params.wait"])
        const notAWait = withGive({ replied: "give", ticked: "tick", timeout: "late" }, handBack({ wait: "list", next: "done" }))
        expect(filtered(notAWait, "GRAPH_HAND_BACK")).toEqual(["GRAPH_HAND_BACK_NO_EVENT@nodes.give.params.wait"])
    })

    /** A talk loop whose body parks at `ask`, with the wait's routes and the body's other steps as given. */
    const talkConfig = (next: Readonly<Record<"replied" | "timeout", string>>, more: Readonly<Record<string, GraphStep>> = {}): TemplateGraphConfig => ({
        key: "test.wait",
        title: { key: "g" },
        input: z.object({ code: z.string().max(200) }),
        triggers: [trigger(TRIGGER.workflowCalled)],
        start: "talk",
        nodes: {
            talk: loop({
                until: equals(ref("steps.ask.output.trigger", { default: null }), "timeout"),
                max: 30,
                body: {
                    start: "ask",
                    nodes: { ask: wait({ for: { replied: waitFor(TRIGGER.zaloMessageReceived) }, timeout: "1d", next }), ...more },
                },
                next: "done",
                exhausted: "done",
            }),
            done: outcome({ name: "done" }),
        },
    })

    it("a wait route may end the round of an `until` body directly (`endRound`, stored as the route left out)", () => {
        const config = talkConfig({ replied: endRound, timeout: endRound })
        expect(waitStepOf(compileTemplateGraph(config).graph.spec)).toMatchObject({ routes: {} })
        expect(problemsOf(config).filter((code) => code.startsWith("WAIT_") || code.startsWith("GRAPH_END_ITEM"))).toEqual([])
    })

    it("outside a loop body a wait route naming `endRound` is refused", () => {
        expect(problemsOf(waitConfig(wait({ for: { replied: waitFor(TRIGGER.zaloMessageReceived) }, timeout: "2h", next: { replied: endRound, timeout: "late" } }))))
            .toEqual(expect.arrayContaining(["GRAPH_END_ITEM_OUTSIDE@nodes.hold.routes.replied"]))
    })

    it("in a body: the hand-back after the wait's trigger route ends the round; one reached from the timeout is refused", () => {
        expect(filtered(talkConfig({ replied: "give", timeout: endRound }, { give: handBack({ wait: "ask" }) }), "GRAPH_HAND_BACK")).toEqual([])
        expect(filtered(talkConfig({ replied: endRound, timeout: "give" }, { give: handBack({ wait: "ask" }) }), "GRAPH_HAND_BACK")).toEqual([
            "GRAPH_HAND_BACK_NO_EVENT@nodes.give.params.wait",
        ])
    })

    /**
     * R33: round 1 skips the wait (its message is the hand-off input), later rounds wait first; one deciding step serves both. The
     * hand-back is guarded by the same round test, so it is reached only in a round that waited.
     */
    const firstRoundConfig = (guarded: boolean): TemplateGraphConfig => ({
        key: "test.wait",
        title: { key: "g" },
        input: z.object({ code: z.string().max(200) }),
        triggers: [trigger(TRIGGER.workflowCalled)],
        start: "talk",
        nodes: {
            talk: loop({
                until: equals(ref("steps.ask.output.trigger", { default: null }), "timeout"),
                max: 30,
                body: {
                    start: "opening",
                    nodes: {
                        opening: ifNode({ when: equals(round(), 1), yes: "decide", no: "ask" }),
                        ask: wait({ for: { replied: waitFor(TRIGGER.zaloMessageReceived) }, timeout: "1d", next: { replied: "decide", timeout: endRound } }),
                        decide: ifNode({ when: equals(ref("trigger.code", { default: null }), "off"), yes: guarded ? "guard" : "give", no: endRound }),
                        ...(guarded ? { guard: ifNode({ when: equals(round(), 1), yes: endRound, no: "give" }) } : {}),
                        give: handBack({ wait: "ask" }),
                    },
                },
                next: "done",
                exhausted: "done",
            }),
            done: outcome({ name: "done" }),
        },
    })

    it("a hand-back guarded by the round test the wait is skipped by holds; unguarded (round 1 reaches it) it is refused", () => {
        expect(filtered(firstRoundConfig(true), "GRAPH_HAND_BACK")).toEqual([])
        expect(filtered(firstRoundConfig(false), "GRAPH_HAND_BACK")).toEqual(["GRAPH_HAND_BACK_NO_EVENT@nodes.give.params.wait"])
    })
})
