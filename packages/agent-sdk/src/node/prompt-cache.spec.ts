import { z } from "../schema/zod-entry"
import { EXAMPLE_TURN } from "../tests/fixtures/node-examples"
import { scriptedNodePorts } from "../tests/fixtures/node-ports"
import { defineEffect, defineTool } from "./effect"
import { guidedModelRequest, runNode } from "./host"
import type { NodeRunRequest } from "./host.types"
import { defineNode } from "./node"
import type { Namespaced } from "../schema/schema.types"
import type { NodeDefinition, NodeModelRequest, TurnRef } from "./node.types"

/**
 * PROMPT CACHE: a provider caches the prefix of a prompt, so the stable part of every model call of the engine (`opening.craft` L1:
 * the agent's craft and tool set; `opening.policies` L2: the workspace's policies; `instructions` L3: the step) must be the same text, byte for
 * byte, whatever changes from call to call; the volatile part (`volatile`, `input`, `turns`) comes after it. These specs hold that layout.
 */

const settle = defineEffect({
    id: "nivo.tool.payment.order.settle",
    title: { key: "t.settle" },
    payload: z.object({ orderId: z.string(), transactionId: z.string() }),
})
const send = defineEffect({
    id: "nivo.tool.customer.message.send",
    title: { key: "t.send" },
    payload: z.object({ conversationId: z.string(), text: z.string() }),
})
const lookUp = defineTool({
    id: "catalog.item.find",
    title: { key: "t.find" },
    args: z.object({ words: z.string() }),
    result: z.object({ items: z.array(z.string()) }),
    mutates: false,
})

const EFFECTS = new Map([settle, send].map((effect) => [effect.id, effect]))
const TOOLS = new Map([[lookUp.id, lookUp]])

/** The agent's whole set, as its module declares it: given out of name order on purpose. */
const AGENT_TOOLS = ["nivo.tool.payment.order.settle", "catalog.item.find", "nivo.tool.customer.message.send"]

const stepOf = (
    id: Namespaced,
    goal: string,
    effects: ReadonlyArray<Namespaced>,
    output: z.ZodType,
    done: unknown,
): NodeDefinition =>
    defineNode({
        id,
        role: "output",
        title: { key: "t" },
        params: z.object({}),
        input: z.record(z.string(), z.unknown()),
        output,
        effects: [...effects],
        run: async (input, context) => {
            const decision = await context.agent.run({ goal, input, output })
            return decision.kind === "confused" ? context.confused(decision.confusion) : decision.value
        },
        examples: [{ name: "answers", params: {}, input: {}, output: done, effects: [], model: [{ done }] }],
    })

const SETTLE_STEP = stepOf(
    "payment.settle",
    "Mark the order paid.",
    ["nivo.tool.payment.order.settle"],
    z.object({ paid: z.boolean() }),
    {
        paid: true,
    },
)
const REPLY_STEP = stepOf(
    "chat.reply",
    "Answer the customer.",
    ["nivo.tool.customer.message.send"],
    z.object({ said: z.string() }),
    {
        said: "ok",
    },
)

const TURN: TurnRef = {
    ...EXAMPLE_TURN,
    guidance: "Speak kindly. Never promise a refund.",
    agentTools: AGENT_TOOLS,
}

/** Runs a step to its `done` and answers every model request it made. */
const asksOf = async (
    node: NodeDefinition,
    turn: TurnRef,
    input: Readonly<Record<string, unknown>>,
    key: string,
    model: ReadonlyArray<unknown>,
    policies?: () => Promise<string>,
): Promise<ReadonlyArray<NodeModelRequest>> => {
    const fake = scriptedNodePorts({ model: [...model] })
    const json = jest.spyOn(fake.ports.model, "json")
    const request: NodeRunRequest = {
        node,
        params: {},
        input,
        turn,
        grant: {},
        effects: EFFECTS,
        tools: TOOLS,
        key,
    }
    await runNode(request, policies === undefined ? fake.ports : { ...fake.ports, policies })
    return json.mock.calls.map((call) => call[1])
}

const PAID = { done: { paid: true } }
const SETTLE_CALL = {
    call: { tool: "nivo.tool.payment.order.settle", args: { orderId: "o-1", transactionId: "tx-1" } },
}

describe("prompt cache: what the tool set costs", () => {
    const audience = "Who also reads the line: the owner alone, or a group too."
    const post = defineEffect({
        id: "nivo.tool.team.message.post",
        title: { key: "effectTeamPost" },
        payload: z.union([
            z.object({ kind: z.literal("text"), text: z.string(), audience: z.string().describe(audience) }),
            z.object({ kind: z.literal("card"), orderId: z.string(), audience: z.string().describe(audience) }),
        ]),
    })
    const frameOf = (words?: (key: string) => string | undefined) => ({
        turn: { ...EXAMPLE_TURN, agentTools: ["nivo.tool.team.message.post", "nivo.tool.customer.message.send"] },
        effects: new Map([post, send].map((effect) => [effect.id, effect])),
        tools: new Map(),
        ...(words === undefined ? {} : { words }),
    })
    const shown = (words?: (key: string) => string | undefined): string =>
        guidedModelRequest(frameOf(words), { purpose: "p", instructions: "Decide.", input: {} }).opening?.craft ?? ""

    it("says what a tool does in words, never as a bare text key; a key with no words stays the key", () => {
        const text = shown((key) => (key === "effectTeamPost" ? "Tell the owner in the chat" : undefined))

        expect(text).toContain('"does":"Tell the owner in the chat"')
        expect(text).not.toContain("effectTeamPost")
        expect(text).toContain('"does":"t.send"')
        expect(shown()).toContain('"does":"effectTeamPost"')
    })

    it("states a description every branch of a union repeats once, and keeps every branch's members", () => {
        const text = shown()

        expect(text.split(audience)).toHaveLength(2)
        expect(text.match(/"audience":/gu)).toHaveLength(2)
        expect(text).toContain('"const":"text"')
        expect(text).toContain('"const":"card"')
        expect(text).toContain("a description is written once")
    })

    it("leaves the dialect address out of every schema it shows", async () => {
        expect(shown()).not.toContain("$schema")
        const [asked] = await asksOf(SETTLE_STEP, TURN, {}, "k", [PAID])
        expect(asked?.instructions).not.toContain("$schema")
        expect(asked?.opening?.craft).not.toContain("$schema")
    })
})

describe("prompt cache: the stable prefix of a model call", () => {
    it("is byte-identical for the same agent, workspace and step whatever the volatile data is", async () => {
        const [first] = await asksOf(
            SETTLE_STEP,
            TURN,
            { orderId: "o-1", at: "2026-11-10T01:00:00Z" },
            "run-1:settle",
            [PAID],
        )
        const [second] = await asksOf(
            SETTLE_STEP,
            {
                ...TURN,
                turnId: "turn-other",
                subject: { kind: "lead", id: "lead-77" },
                waitingOnFounder: [{ step: "Mark as paid", since: "2026-11-10T04:00:00.000Z" }],
                founderAnswers: [{ text: "approved", at: "2026-11-10T05:00:00.000Z" }],
                alreadySent: [{ text: "The shop is checking.", at: "2026-11-10T04:30:00.000Z" }],
            },
            { orderId: "o-999", at: "2026-11-11T09:30:00Z", thread: ["hello", "still in stock?"] },
            "run-2:settle",
            [PAID],
        )

        expect(first?.instructions).toBe(second?.instructions)
        // What differs rides after the stable part.
        expect(first?.volatile).toBeUndefined()
        expect(second?.volatile).toEqual(expect.stringContaining("`founderAnswers`"))
        expect(second?.input).not.toEqual(first?.input)
    })

    it("hands the founder's decisions for the customer and the credits joined to the run as volatile facts, never in the stable part (D-MX-1, D-MX-3)", async () => {
        const [plain] = await asksOf(SETTLE_STEP, TURN, {}, "run-1:settle", [PAID])
        const [told] = await asksOf(
            SETTLE_STEP,
            {
                ...TURN,
                founderDecisions: [
                    {
                        question: "Does the shop issue VAT invoices?",
                        answer: "Yes, 8% fee",
                        at: "2026-11-11T09:11:00.000Z",
                    },
                ],
                creditsJoined: [
                    {
                        transactionId: "tx-2",
                        amountVnd: 1000,
                        reference: "DH202611110005",
                        at: "2026-11-11T09:03:00.000Z",
                    },
                ],
            },
            {},
            "run-1:settle",
            [PAID],
        )

        expect(told?.instructions).toBe(plain?.instructions)
        expect(told?.volatile).toEqual(expect.stringContaining("`founderDecisions`"))
        expect(told?.volatile).toEqual(expect.stringContaining("`creditsJoined`"))
        expect(told?.input).toMatchObject({
            founderDecisions: [{ question: "Does the shop issue VAT invoices?", answer: "Yes, 8% fee" }],
            creditsJoined: [{ transactionId: "tx-2", amountVnd: 1000 }],
        })
    })

    it("holds nothing volatile: no id of the run, the turn or its subject, no clock, no thread", async () => {
        const turn: TurnRef = {
            ...TURN,
            turnId: "turn-SECRET",
            subject: { kind: "lead", id: "lead-SECRET" },
            founderAnswers: [{ text: "answer-SECRET", at: "2026-11-10T05:00:00.000Z" }],
            alreadySent: [{ text: "sent-SECRET", at: "2026-11-10T04:30:00.000Z" }],
        }
        const [asked] = await asksOf(SETTLE_STEP, turn, { thread: "thread-SECRET" }, "run-SECRET:settle", [PAID])

        expect(asked?.instructions).not.toMatch(/SECRET|2026-11-10/u)
        expect(JSON.stringify(asked?.input)).toContain("thread-SECRET")
    })

    it("is shared by two different steps of the agent up to the step itself: the craft and the whole tool set (L1)", async () => {
        const [settleAsk] = await asksOf(SETTLE_STEP, TURN, {}, "run-1:settle", [PAID])
        const [replyAsk] = await asksOf(REPLY_STEP, TURN, {}, "run-1:reply", [{ done: { said: "ok" } }])
        const craft = settleAsk?.opening?.craft ?? ""

        expect(replyAsk?.opening).toEqual(settleAsk?.opening)
        // L1: guidance, then the full set in name order (not the step's own tools); nothing about how a call answers.
        expect(craft.startsWith("Speak kindly. Never promise a refund.\n\n")).toBe(true)
        const names = [
            '"name":"catalog.item.find"',
            '"name":"nivo.tool.customer.message.send"',
            '"name":"nivo.tool.payment.order.settle"',
        ]
        const places = names.map((name) => craft.indexOf(name))
        expect(places.every((place) => place > 0)).toBe(true)
        expect([...places].sort((left, right) => left - right)).toEqual(places)
        expect(craft).not.toContain("You act by calling tools")
        // L3: how a turn answers, then the step; the step names what it may call, the right itself stays in code.
        expect(settleAsk?.instructions.startsWith("You act by calling tools")).toBe(true)
        expect(settleAsk?.instructions).toContain("Mark the order paid.")
        expect(replyAsk?.instructions).toContain("Answer the customer.")
        expect(settleAsk?.instructions).toContain('"tools":["nivo.tool.payment.order.settle"]')
    })

    it("writes equal data as equal text: the order the tool ids were given in does not show", async () => {
        const shuffled: TurnRef = {
            ...TURN,
            agentTools: [...AGENT_TOOLS].reverse(),
        }
        const [first] = await asksOf(SETTLE_STEP, TURN, {}, "k", [PAID])
        const [second] = await asksOf(SETTLE_STEP, shuffled, {}, "k", [PAID])

        expect(second?.opening).toEqual(first?.opening)
        expect(second?.instructions).toBe(first?.instructions)
    })

    it("keeps the turns of one step append-only: the same L1-L3 and input every turn, the turns so far only grow at the end", async () => {
        const asks = await asksOf(SETTLE_STEP, TURN, { orderId: "o-1" }, "run-1:settle", [
            SETTLE_CALL,
            SETTLE_CALL,
            PAID,
        ])
        expect(asks).toHaveLength(3)
        expect(new Set(asks.map((ask) => JSON.stringify([ask.opening, ask.instructions, ask.input]))).size).toBe(1)
        expect(asks[0]?.turns).toBeUndefined()
        expect(asks[1]?.turns).toHaveLength(1)
        expect(asks[2]?.turns).toHaveLength(2)
        // An earlier turn is never rewritten: the second turn's list opens the third's.
        expect(asks[2]?.turns?.[0]).toEqual(asks[1]?.turns?.[0])
        expect(asks[1]?.turns?.[0]).toMatchObject({ tool: "nivo.tool.payment.order.settle", ok: true, turnsLeft: 4 })
        expect(asks[0]?.input).toMatchObject({ turnsLeft: 5 })
    })

    it("lays a host's own call for the agent out the same way, so it shares the craft and the tool set", async () => {
        const [stepAsk] = await asksOf(SETTLE_STEP, TURN, {}, "k", [PAID])
        const core = guidedModelRequest(
            { turn: TURN, effects: EFFECTS, tools: TOOLS },
            { purpose: "core", instructions: "Decide what to do with the stuck step.", input: { reason: "x" } },
        )

        // The same L1 as a step's turn: one cache entry for every call of the agent; the call's own words are its L3, unchanged.
        expect(core.opening).toEqual(stepAsk?.opening)
        expect(core.instructions).toBe("Decide what to do with the stuck step.")
    })
})

describe("prompt cache: the workspace's policies are L2, read once per node run", () => {
    const POLICIES = 'nivo.tool.brain.policy.list\n{"notListed":0,"policies":[{"id":"f-1","value":"500"}]}'

    it("puts the workspace's policies after the craft and before the step: a rule change changes L2 only", async () => {
        const [before] = await asksOf(SETTLE_STEP, TURN, {}, "run-1:settle", [PAID], () => Promise.resolve(POLICIES))
        const [after] = await asksOf(SETTLE_STEP, TURN, {}, "run-2:settle", [PAID], () =>
            Promise.resolve(POLICIES.replace('"500"', '"300"')),
        )
        const [none] = await asksOf(SETTLE_STEP, TURN, {}, "run-3:settle", [PAID])

        expect(before?.opening?.policies).toBe(POLICIES)
        expect(after?.opening?.craft).toBe(before?.opening?.craft)
        expect(after?.opening?.policies).not.toBe(before?.opening?.policies)
        expect(after?.instructions).toBe(before?.instructions)
        expect(after?.input).toEqual(before?.input)
        expect(none?.opening).toEqual({ craft: before?.opening?.craft, policies: "" })
    })

    it("reads the policies once per node run, however many turns the agent takes", async () => {
        const policies = jest.fn(() => Promise.resolve(POLICIES))
        const asks = await asksOf(SETTLE_STEP, TURN, {}, "run-1:settle", [SETTLE_CALL, PAID], policies)

        expect(asks).toHaveLength(2)
        expect(policies).toHaveBeenCalledTimes(1)
        expect(asks.every((ask) => ask.opening?.policies === POLICIES)).toBe(true)
    })

    it("hands the policies to a host that takes the turns itself, beside the craft and apart from the step", async () => {
        const fake = scriptedNodePorts({ model: [] })
        const loops: Array<{ instructions: string; policies: string | undefined; step: string }> = []
        await runNode(
            {
                node: SETTLE_STEP,
                params: {},
                input: {},
                turn: TURN,
                grant: {},
                effects: EFFECTS,
                tools: TOOLS,
                key: "run-1:settle",
            },
            {
                ...fake.ports,
                policies: () => Promise.resolve(POLICIES),
                agent: (loop) => {
                    loops.push({ instructions: loop.instructions, policies: loop.policies, step: loop.step })
                    loop.done({ paid: true })
                    return Promise.resolve({ turns: 1 })
                },
            },
        )

        expect(loops).toHaveLength(1)
        expect(loops[0]?.policies).toBe(POLICIES)
        expect(loops[0]?.instructions).not.toContain(POLICIES)
        expect(loops[0]?.step.startsWith("Mark the order paid.")).toBe(true)
    })

    it("asks no policies of a node that never calls the model, and none when the host has no policies port", async () => {
        const policies = jest.fn(() => Promise.resolve(POLICIES))
        const fake = scriptedNodePorts({ model: [] })
        const quiet = defineNode({
            id: "payment.quiet",
            role: "output",
            title: { key: "t" },
            params: z.object({}),
            input: z.object({}),
            output: z.object({ ok: z.boolean() }),
            effects: [],
            run: () => Promise.resolve({ ok: true }),
            examples: [{ name: "answers", params: {}, input: {}, output: { ok: true }, effects: [] }],
        })
        await runNode(
            { node: quiet, params: {}, input: {}, turn: TURN, grant: {}, effects: EFFECTS, tools: TOOLS, key: "k" },
            { ...fake.ports, policies },
        )
        expect(policies).not.toHaveBeenCalled()

        const bare = { purpose: "core", instructions: "Decide.", input: {} }
        const plain = guidedModelRequest({ turn: EXAMPLE_TURN, effects: new Map(), tools: new Map() }, bare)
        expect(plain).toBe(bare)
        expect(plain.opening).toBeUndefined()
    })
})
