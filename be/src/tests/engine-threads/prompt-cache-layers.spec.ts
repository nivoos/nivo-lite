import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { Test } from "@nestjs/testing"
import { builder, mock } from "@starci/jest-preset"
import { defineEffect, defineNode, guidedModelRequest, runNode } from "@nivo-lite/agent-sdk/node"
import type { ModelCallFrame, NodeAgentLoop, NodeHostPorts, NodeModelRequest, TurnRef } from "@nivo-lite/agent-sdk/node"
import { EXAMPLE_TURN } from "@nivo-lite/agent-sdk/testing"
import { z } from "zod"
import {
    CONSULT_GOAL_VI,
    CONSULT_SHORT_GOAL_VI,
    CONSULT_WORD_VI,
    CUSTOMER_ROSES_QUESTION_VI,
    FLORIST_GUIDANCE_OPENING_VI,
    FLORIST_GUIDANCE_VI,
    ORDER_GOAL_VI,
    ORDER_WORDS_VI,
    POLITE_YES_VI,
    STILL_ROSES_VI,
} from "@tests/fixtures/i18n/engine-threads-spec.messages"
import { nodeMessagesOf } from "@modules/domain/ai-tasks/node-prompt.policy"
import { workspacePoliciesTextOf } from "@modules/domain/graph-nodes/workspace-policies.policy"
import { AiClient } from "@modules/integrations/ai/ai.client"
import type { AiChatRequest } from "@modules/integrations/ai/ai.contracts"
import { AI_ENDPOINT_OPTIONS } from "@modules/integrations/ai/ai.decorators"
import type { AiEndpoint } from "@modules/integrations/ai/ai.options"
import { usageOf } from "@modules/integrations/ai/reply.policy"
import { AgentLoopClient } from "@modules/integrations/langgraph/agent-loop/agent-loop.client"
import type { AgentLoopModel } from "@modules/integrations/langgraph/agent-loop/agent-loop.port"
import { Secret } from "@modules/platform/config"
import { HTTP_CLIENT } from "@modules/platform/http"
import type { HttpClient, HttpRequest } from "@modules/platform/http"
import { parseJsonText } from "@modules/platform/primitives"

// PROMPT-CACHE (owner-approved design "package -> workspace policies -> step -> run", R91, 2026-11-14): every model call of an agent step is
// laid out in four layers, each stable layer ending with a cache breakpoint on Anthropic's Messages route, the turns of a step appended
// only. Proven on the BUILT requests the Anthropic client sends to the gateway (a fake HTTP port: no live call), on both roads a step's
// agent takes: the JSON road (a plain node call, the SDK's JSON loop) and the prebuilt loop (native tool calling).

const send = defineEffect({
    id: "nivo.tool.customer.message.send",
    title: { key: "t.send" },
    payload: z.object({ conversationId: z.string().max(200), text: z.string().max(200) }),
})
const settle = defineEffect({
    id: "nivo.tool.payment.order.settle",
    title: { key: "t.settle" },
    payload: z.object({ orderId: z.string().max(200), transactionId: z.string().max(200) }),
})
const EFFECTS = new Map([send, settle].map((effect) => [effect.id, effect]))

/** One agent: the craft and the whole tool set every step of the agent carries. */
const TURN: TurnRef = {
    ...EXAMPLE_TURN,
    guidance: FLORIST_GUIDANCE_VI,
    agentTools: ["nivo.tool.payment.order.settle", "nivo.tool.customer.message.send"],
}
const FRAME: ModelCallFrame = { turn: TURN, effects: EFFECTS, tools: new Map() }

/**
 * What `nivo.tool.brain.policy.list` answers for the agent (two policies, in the tool's stable order); `shuffled` writes each member of
 * the answer in another order, which the rendering must not show.
 */
const policyAnswerOf = (value: string, shuffled = false): unknown => {
    const policies = [
        { id: "f-1", group: "G1", title: "Policy one", value, unit: "u", until: null },
        { id: "f-2", group: "G2", title: "Policy two", value: "8-20", unit: null, until: null },
    ]
    return shuffled
        ? { total: 2, policies: policies.map(({ until, unit, value: v, title, group, id }) => ({ until, unit, value: v, title, group, id })), notice: "N" }
        : { notice: "N", total: 2, policies }
}
const POLICIES = workspacePoliciesTextOf(policyAnswerOf("30"))

/** A step's call of the agent, laid out by the SDK's host exactly as a node's call is (`guidedModelRequest`). */
const stepCall = (goal: string, input: unknown, policies = ""): NodeModelRequest =>
    guidedModelRequest(FRAME, { purpose: "sales.consult-turn:consult", instructions: goal, input }, policies)

const ANSWER = z.object({ reply: z.string().max(2000) })

/** An Anthropic Messages reply as the gateway answers it. */
const replyOf = (content: ReadonlyArray<unknown>, usage: Readonly<Record<string, number>> = { input_tokens: 10, output_tokens: 2 }) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason: content.some((part) => typeof part === "object" && part !== null && Reflect.get(part, "type") === "tool_use")
        ? "tool_use"
        : "end_turn",
    stop_sequence: null,
    usage,
})

/** The gateway: its catalog (one name served through Anthropic's Messages route) and the scripted replies, one per model call. */
const gateway = (replies: ReadonlyArray<unknown> = []): ReturnType<typeof mock<HttpClient>> => {
    const http = mock<HttpClient>()
    const left = [...replies]
    http.request.mockImplementation((request) =>
        Promise.resolve(
            request.method === "GET"
                ? {
                      status: 200,
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                          object: "list",
                          data: [{ object: "model", id: "claude", kinds: ["anthropic"], serves: ["chat"] }],
                      }),
                  }
                : {
                      status: 200,
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(left.shift() ?? replyOf([{ type: "text", text: `{"reply":"${POLITE_YES_VI}"}` }])),
                  },
        ),
    )
    return http
}

const clientOf = async (http: HttpClient): Promise<AiClient> => {
    const endpoint = builder<AiEndpoint>({
        gatewayUrl: "http://gateway.test/v1",
        virtualKey: new Secret("sk-starci-test"),
        chatModel: "claude",
        embeddingModel: "embed",
    })()
    const moduleRef = await Test.createTestingModule({
        providers: [AiClient, { provide: AI_ENDPOINT_OPTIONS, useValue: endpoint }, { provide: HTTP_CLIENT, useValue: http }],
    }).compile()
    return moduleRef.get(AiClient)
}

/** One text part of the system the Anthropic client sent. */
interface SystemPart {
    readonly type: string
    readonly text: string
    readonly cache_control?: { readonly type: string }
}

/** Whether a parsed JSON value is an object with named members. */
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null

/** Whether a parsed JSON value is a text part of the system the client sent. */
const isSystemPart = (value: unknown): value is SystemPart =>
    isRecord(value) && typeof value.type === "string" && typeof value.text === "string"

/** The body of a request the client sent, or an empty one when its bytes are no JSON object. */
const bodyOf = (request: HttpRequest): Readonly<Record<string, unknown>> => {
    const read = parseJsonText(request.bytes?.toString("utf8") ?? "{}")
    return read.ok && isRecord(read.value) ? read.value : {}
}

/** The body the client sent for each model call (the catalog reads left out). */
const bodiesOf = (http: ReturnType<typeof mock<HttpClient>>): ReadonlyArray<Readonly<Record<string, unknown>>> =>
    http.request.mock.calls
        .map(([request]) => request)
        .filter((request) => request.method !== "GET")
        .map((request) => bodyOf(request))

const systemOf = (body: Readonly<Record<string, unknown>> | undefined): ReadonlyArray<SystemPart> =>
    Array.isArray(body?.system) ? body.system.filter(isSystemPart) : []

const messagesOf = (body: Readonly<Record<string, unknown>> | undefined): ReadonlyArray<unknown> =>
    Array.isArray(body?.messages) ? body.messages : []

/** How many cache breakpoints a request carries, the top-level automatic one included. */
const marksOf = (body: Readonly<Record<string, unknown>> | undefined): number => (JSON.stringify(body).match(/"cache_control"/gu) ?? []).length

/** The JSON request a call sends, as the engine sends it: the node prompt's messages, on the Anthropic route. */
const chatOf = (ask: NodeModelRequest, json: boolean): AiChatRequest => ({
    messages: nodeMessagesOf(ask, json ? ANSWER : null),
    json,
    schema: null,
    timeoutMs: 5000,
    context: null,
    target: { name: "claude", sampling: false, forcedToolChoice: false, upstreamFields: false },
})

/** Sends a step's call as the engine does. */
const sent = async (client: AiClient, ask: NodeModelRequest): Promise<void> => {
    await client.chat(chatOf(ask, true))
}

describe("prompt cache, JSON road: a plain node call and the JSON loop (the built Anthropic request)", () => {
    it("sends two steps of one agent with the same L1 and L2, byte for byte, each layer end marked; L3 per step", async () => {
        const http = gateway()
        const client = await clientOf(http)

        await sent(client, stepCall(CONSULT_GOAL_VI, { thread: [CUSTOMER_ROSES_QUESTION_VI] }, POLICIES))
        await sent(client, stepCall(ORDER_GOAL_VI, { orderId: "o-1", at: "2026-11-11T10:00:00Z" }, POLICIES))

        const [consult, order] = bodiesOf(http).map(systemOf)
        // L1: the agent's craft and its whole tool set; identical, marked, and holding nothing of either step.
        expect(consult?.[0]?.text).toBe(order?.[0]?.text)
        expect(consult?.[0]?.cache_control).toEqual({ type: "ephemeral" })
        expect(consult?.[0]?.text.startsWith(FLORIST_GUIDANCE_OPENING_VI)).toBe(true)
        expect(consult?.[0]?.text).toContain('"name":"nivo.tool.customer.message.send"')
        expect(consult?.[0]?.text).not.toMatch(new RegExp(`${CONSULT_WORD_VI}|${ORDER_WORDS_VI}|o-1|2026-11-11`, "u"))
        // L2: the workspace's policies; identical, marked.
        expect(consult?.[1]?.text).toBe(POLICIES)
        expect(order?.[1]).toEqual(consult?.[1])
        expect(consult?.[1]?.cache_control).toEqual({ type: "ephemeral" })
        // L3: the step's own words and the answer's schema, marked at its end; different per step.
        expect(consult?.[2]?.text.startsWith(CONSULT_GOAL_VI)).toBe(true)
        expect(order?.[2]?.text.startsWith(ORDER_GOAL_VI)).toBe(true)
        expect(consult?.[2]?.cache_control).toEqual({ type: "ephemeral" })
        // The volatile input is never in the system: it is the user message.
        expect(JSON.stringify(consult)).not.toContain(STILL_ROSES_VI)
    })

    it("stays within Anthropic's four breakpoints: three layer ends and the automatic one", async () => {
        const http = gateway()
        await sent(await clientOf(http), stepCall(CONSULT_SHORT_GOAL_VI, {}, POLICIES))

        const [body] = bodiesOf(http)
        expect(body?.cache_control).toEqual({ type: "ephemeral" })
        expect(marksOf(body)).toBe(4)
    })

    it("changes L2 alone when a policy changes, and not at all when the answer writes its members in another order", async () => {
        const http = gateway()
        const client = await clientOf(http)
        await sent(client, stepCall(CONSULT_SHORT_GOAL_VI, { text: "a" }, POLICIES))
        await sent(client, stepCall(CONSULT_SHORT_GOAL_VI, { text: "a" }, workspacePoliciesTextOf(policyAnswerOf("30", true))))
        await sent(client, stepCall(CONSULT_SHORT_GOAL_VI, { text: "a" }, workspacePoliciesTextOf(policyAnswerOf("40"))))

        const [before, reordered, changed] = bodiesOf(http)
        expect(JSON.stringify(reordered)).toBe(JSON.stringify(before))
        const [l1, l2, l3] = systemOf(before)
        const [c1, c2, c3] = systemOf(changed)
        expect(c1).toEqual(l1)
        expect(c2).not.toEqual(l2)
        expect(c3).toEqual(l3)
        expect(messagesOf(changed)).toEqual(messagesOf(before))
    })

    it("keeps ONE marked part for a call with no shared opening (a turn with no craft and a workspace with no policies)", async () => {
        const http = gateway()
        const bare = guidedModelRequest(
            { turn: EXAMPLE_TURN, effects: new Map(), tools: new Map() },
            { purpose: "p", instructions: CONSULT_SHORT_GOAL_VI, input: {} },
        )
        await sent(await clientOf(http), bare)

        const [system] = bodiesOf(http).map(systemOf)
        expect(system?.filter((part) => part.cache_control !== undefined)).toHaveLength(1)
        expect(system?.[0]?.text.startsWith(CONSULT_SHORT_GOAL_VI)).toBe(true)
    })

    it("keeps the JSON loop's turns append-only on the wire: the second turn's request is the first's plus the turn it came to", async () => {
        // A step whose agent takes two turns on the SDK's JSON loop: a call, then its output. Each turn goes to the gateway as the
        // engine sends it (node prompt -> Anthropic client).
        const http = gateway([
            replyOf([{ type: "text", text: JSON.stringify({ call: { tool: send.id, args: { conversationId: "c-1", text: "hi" } } }) }]),
            replyOf([{ type: "text", text: JSON.stringify({ done: { reply: POLITE_YES_VI } }) }]),
        ])
        const client = await clientOf(http)
        const step = defineNode({
            id: "sales.consult-turn",
            role: "output",
            title: { key: "t" },
            params: z.object({}),
            input: z.record(z.string(), z.unknown()),
            output: ANSWER,
            effects: [send.id],
            run: async (input, context) => {
                const decision = await context.agent.run({ goal: CONSULT_GOAL_VI, input, output: ANSWER })
                return decision.kind === "confused" ? context.confused(decision.confusion) : decision.value
            },
            examples: [{ name: "answers", params: {}, input: {}, output: { reply: "x" }, effects: [], model: [{ done: { reply: "x" } }] }],
        })
        const ports: NodeHostPorts = {
            read: () => Promise.resolve([]),
            write: (kind) => Promise.resolve({ kind, id: "r-1" }),
            execute: (effect) => Promise.resolve({ kind: effect.id, id: "m-1" }),
            callTool: () => Promise.resolve(null),
            model: {
                text: () => Promise.resolve(""),
                json: async (schema, request) => schema.parse((await client.chat(chatOf(request, true))).parsed),
            },
            now: () => new Date("2026-11-14T10:00:00Z"),
            policies: () => Promise.resolve(POLICIES),
        }

        const ran = await runNode(
            { node: step, params: {}, input: { thread: [CUSTOMER_ROSES_QUESTION_VI] }, turn: TURN, grant: {}, effects: EFFECTS, tools: new Map(), key: "run-1:consult" },
            ports,
        )

        expect(ran.output).toEqual({ reply: POLITE_YES_VI })
        const [first, second] = bodiesOf(http)
        expect(JSON.stringify(systemOf(second))).toBe(JSON.stringify(systemOf(first)))
        const [one, two] = [messagesOf(first), messagesOf(second)]
        expect(two).toHaveLength(one.length + 1)
        expect(JSON.stringify(two.slice(0, one.length))).toBe(JSON.stringify(one))
        expect(two.at(-1)).toEqual({ role: "user", content: expect.stringContaining('"tool":"nivo.tool.customer.message.send"') })
        expect(marksOf(second)).toBe(4)
    })
})

/** A frame of a step's agent as the SDK's runner hands it to the prebuilt loop; the closures take the first output. */
const loopOf = (step: string, input: unknown, policies: string): { readonly loop: NodeAgentLoop; readonly ended: { output: unknown } } => {
    const ended: { output: unknown } = { output: null }
    return {
        ended,
        loop: {
            purpose: "sales.consult-turn:agent",
            instructions: `${FLORIST_GUIDANCE_VI}\n\nYou act by calling tools.`,
            ...(policies === "" ? {} : { policies }),
            step,
            input,
            tools: [
                { name: send.id, does: "Send the customer a line.", argsSchema: { type: "object", properties: { text: { type: "string" } } } },
                { name: settle.id, does: "Settle an order.", argsSchema: { type: "object", properties: { orderId: { type: "string" } } } },
            ],
            maxTurns: 4,
            call: () => Promise.resolve({ ok: true, result: { sent: true } }),
            done: (output) => {
                ended.output = output
                return { ok: true }
            },
            confused: () => ({ ok: true }),
        },
    }
}

/** The model side of the prebuilt loop over the router's Anthropic client of the fake gateway: one try per turn, nothing metered. */
const modelOf = async (client: AiClient): Promise<AgentLoopModel> => {
    const built: BaseChatModel = await client.turnModel({ timeoutMs: 5000, target: { name: "claude", sampling: false, forcedToolChoice: false, upstreamFields: false } })
    return { toolChoice: "auto", model: built, turn: (attempt) => attempt(built, 1) }
}

const CALL_SEND = [{ type: "tool_use", id: "toolu_1", name: send.id, input: { text: "hi" } }]
const CALL_DONE = [{ type: "tool_use", id: "toolu_2", name: "done", input: { output: { reply: POLITE_YES_VI } } }]

describe("prompt cache, prebuilt loop: the consult step's two turns on native tool calling (the built Anthropic request)", () => {
    it("sends the second turn as the first plus what the first came to: tools, L1, L2, L3 and the first message byte for byte", async () => {
        const http = gateway([replyOf(CALL_SEND), replyOf(CALL_DONE)])
        const { loop, ended } = loopOf(CONSULT_GOAL_VI, { thread: [CUSTOMER_ROSES_QUESTION_VI] }, POLICIES)
        await new AgentLoopClient().run(loop, await modelOf(await clientOf(http)))

        expect(ended.output).toEqual({ reply: POLITE_YES_VI })
        const [first, second] = bodiesOf(http)
        expect(JSON.stringify(second?.tools)).toBe(JSON.stringify(first?.tools))
        expect(JSON.stringify(systemOf(second))).toBe(JSON.stringify(systemOf(first)))
        const [one, two] = [messagesOf(first), messagesOf(second)]
        expect(JSON.stringify(two.slice(0, one.length))).toBe(JSON.stringify(one))
        expect(two.length).toBeGreaterThan(one.length)
        // L1 and L2 end the system, L3 ends the first part of the first message; the automatic one rides on the last block.
        expect(systemOf(first).map((part) => part.cache_control)).toEqual([{ type: "ephemeral" }, { type: "ephemeral" }])
        expect(systemOf(first)[1]?.text).toBe(POLICIES)
        expect(JSON.stringify(one[0])).toContain('"cache_control":{"type":"ephemeral"}')
        expect(first?.cache_control).toEqual({ type: "ephemeral" })
        expect(marksOf(first)).toBe(4)
        expect(marksOf(second)).toBe(4)
        // The whole tool set every turn, plus the loop's own two: never a per-turn subset.
        expect(Array.isArray(first?.tools) ? first.tools.map((tool: unknown) => (isRecord(tool) ? tool.name : null)) : []).toEqual([
            send.id,
            settle.id,
            "done",
            "confused",
        ])
    })

    it("sends two runs of the same step in one workspace with the same tools, system and step part: only the try differs", async () => {
        const http = gateway([replyOf(CALL_DONE), replyOf(CALL_DONE)])
        const client = await clientOf(http)
        await new AgentLoopClient().run(loopOf(CONSULT_GOAL_VI, { thread: ["a"], contactId: "c-1" }, POLICIES).loop, await modelOf(client))
        await new AgentLoopClient().run(loopOf(CONSULT_GOAL_VI, { thread: ["b", "c"], contactId: "c-2" }, POLICIES).loop, await modelOf(client))

        const [first, second] = bodiesOf(http)
        expect(JSON.stringify(second?.tools)).toBe(JSON.stringify(first?.tools))
        expect(JSON.stringify(systemOf(second))).toBe(JSON.stringify(systemOf(first)))
        const stepPart = (body: Readonly<Record<string, unknown>> | undefined): string => {
            const [opening] = messagesOf(body)
            const content: unknown = isRecord(opening) ? opening.content : null
            return JSON.stringify(Array.isArray(content) ? content[0] : null)
        }
        expect(stepPart(second)).toBe(stepPart(first))
        expect(stepPart(first)).toContain(CONSULT_GOAL_VI.slice(0, 20))
        expect(JSON.stringify(messagesOf(second))).not.toBe(JSON.stringify(messagesOf(first)))
    })

    it("sends the same step in two workspaces with the same tools and L1; L2 is each workspace's own", async () => {
        const http = gateway([replyOf(CALL_DONE), replyOf(CALL_DONE)])
        const client = await clientOf(http)
        await new AgentLoopClient().run(loopOf(CONSULT_GOAL_VI, { thread: ["a"] }, POLICIES).loop, await modelOf(client))
        await new AgentLoopClient().run(
            loopOf(CONSULT_GOAL_VI, { thread: ["a"] }, workspacePoliciesTextOf(policyAnswerOf("15"))).loop,
            await modelOf(client),
        )

        const [workspaceA, workspaceB] = bodiesOf(http)
        expect(JSON.stringify(workspaceB?.tools)).toBe(JSON.stringify(workspaceA?.tools))
        expect(systemOf(workspaceB)[0]).toEqual(systemOf(workspaceA)[0])
        expect(systemOf(workspaceB)[1]).not.toEqual(systemOf(workspaceA)[1])
        expect(JSON.stringify(messagesOf(workspaceB))).toBe(JSON.stringify(messagesOf(workspaceA)))
    })
})

describe("prompt cache: what the meter books is what the provider says it read and wrote", () => {
    it("reads the cache reads and writes of an Anthropic reply into the call's usage (prompt = full price + reads + writes)", async () => {
        const http = gateway([
            replyOf([{ type: "text", text: `{"reply":"${POLITE_YES_VI}"}` }], {
                input_tokens: 300,
                output_tokens: 20,
                cache_read_input_tokens: 15000,
                cache_creation_input_tokens: 1200,
            }),
        ])
        const reply = await (await clientOf(http)).chat(chatOf(stepCall(CONSULT_SHORT_GOAL_VI, {}, POLICIES), true))

        expect(usageOf(reply.usageMetadata, reply.responseMetadata)).toMatchObject({
            promptTokens: 16500,
            cachedTokens: 15000,
            cacheWriteTokens: 1200,
            completionTokens: 20,
        })
    })
})
