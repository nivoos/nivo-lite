import { readFileSync } from "node:fs"
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages"
import { mock } from "@starci/jest-preset"
import { ProviderSandboxErrorCode } from "@modules/domain/provider-sandbox"
import { AiService } from "@modules/integrations/ai"
import type { Clock } from "@modules/platform/clock"
import type { Logger } from "@modules/platform/logging"
import { sandboxAccount, sandboxServiceOf, sandboxServiceOff } from "@tests/fixtures/builders/provider-sandbox.builder"
import type { AiChatModel, AiChatRequest, AiRunner, AiTurnRequest, ChainReply } from "./model-provider.contracts"
import {
    MODEL_CALL_OPERATION,
    MODEL_SANDBOX_CASE,
    MODEL_SANDBOX_CATALOGUE,
    MODEL_SANDBOX_MODEL,
    type ModelSandboxCaseId,
} from "./model-sandbox.catalogue"
import { MODEL_SANDBOX_CONFUSION, MODEL_SANDBOX_MALFORMED_TEXT } from "./model-sandbox-replies.policy"
import { ModelSandboxRunnerService } from "./model-sandbox-runner.service"

const ACCOUNT = sandboxAccount({ id: "conn-model", workspaceId: "ws-1", provider: "model" })
const PURPOSE = "chatbot.answer:agent"
const FACTS = "document_read:extract"

const REQUEST: AiChatRequest = {
    messages: [
        { role: "system", content: "You read rules." },
        { role: "user", content: "Giao hang noi thanh 30.000d." },
    ],
    json: true,
    schema: null,
    timeoutMs: 90_000,
    context: null,
    affinity: "ws-1",
}

const TURN: AiTurnRequest = { timeoutMs: 90_000, affinity: "ws-1" }

/** The endpoint: answers a chat call with a real-looking reply and a turn with a client that answers words; counts what reached it. */
const endpointOf = () => {
    const reached = { chat: 0, turn: 0, embed: 0 }
    const reply: ChainReply = {
        content: "1|policy|Shipping|fee|30.000 VND|-|-|-",
        parsed: null,
        usageMetadata: { input_tokens: 120, output_tokens: 12, total_tokens: 132 },
        responseMetadata: { model_name: "claude-sonnet-5-5", finish_reason: "end_turn" },
        retrieved: 0,
        provider: "Anthropic",
    }
    const client: AiChatModel = mock<AiChatModel>({
        bindTools: jest.fn(() => client),
        invoke: jest.fn(() => {
            reached.turn += 1
            return Promise.resolve(new AIMessageChunk({ content: "from the endpoint" }))
        }),
    })
    const endpoint: AiRunner = {
        chat: () => {
            reached.chat += 1
            return Promise.resolve(reply)
        },
        turnModel: () => Promise.resolve(client),
        embed: () => {
            reached.embed += 1
            return Promise.resolve([[0.1, 0.2]])
        },
    }
    return { endpoint, reached, reply }
}

/** NIVO's REAL model door over a runner: what reads every sandbox answer exactly as it reads the live endpoint. */
const doorOver = (runner: AiRunner): AiService =>
    new AiService(
        mock<ConstructorParameters<typeof AiService>[0]>({ chatModel: "work" }),
        runner,
        mock<Logger>(),
        mock<Clock>({ now: () => new Date(0) }),
    )

const setup = () => {
    const { sandbox, store } = sandboxServiceOf(ACCOUNT)
    const service = new ModelSandboxRunnerService(sandbox)
    const { endpoint, reached, reply } = endpointOf()
    const runnerFor = (purpose: string): AiRunner => service.runnerOf(ACCOUNT, purpose, endpoint)
    const pick = (caseId: ModelSandboxCaseId, scope: string = MODEL_CALL_OPERATION): Promise<void> =>
        sandbox.setNextCase(ACCOUNT, scope, caseId)
    return { sandbox, store, service, endpoint, reached, reply, runnerFor, pick }
}

/** One try of an agent turn as the loop makes it: the try's client, invoked. */
const turnTry = async (runner: AiRunner): Promise<unknown> => (await runner.turnModel(TURN)).invoke([new HumanMessage("hi")])

describe("ModelSandboxRunnerService: chat calls, read by the REAL model door", () => {
    it("MODEL-1 (default): the call passes to the endpoint unchanged; the log says passed, never the real answer", async () => {
        const t = setup()
        const tried = await doorOver(t.runnerFor(FACTS)).attempt(REQUEST)
        expect(tried).toMatchObject({ ok: true, answer: { text: "1|policy|Shipping|fee|30.000 VND|-|-|-", model: "claude-sonnet-5-5" } })
        expect(t.reached.chat).toBe(1)
        const calls = await t.sandbox.calls(ACCOUNT)
        expect(calls.map((one) => [one.operation, one.key, one.result])).toEqual([
            [FACTS, FACTS, { outcome: "answered", value: { case: MODEL_SANDBOX_CASE.passed, passed: true } }],
        ])
        expect(JSON.stringify(calls[0]?.request)).not.toContain("Giao hang")
        expect(calls[0]?.request).toEqual({ kind: "chat", json: true, structured: false, messages: 2, chars: 43, timeoutMs: 90_000 })
    })

    it("MODEL-2 refuses: finish `refusal`, no text -> the door's failed try `empty`, with zero usage under the sandbox model", async () => {
        const t = setup()
        await t.pick(MODEL_SANDBOX_CASE.refused)
        const tried = await doorOver(t.runnerFor(FACTS)).attempt(REQUEST)
        expect(tried).toMatchObject({ ok: false, failure: "empty", spent: { model: MODEL_SANDBOX_MODEL, usage: { promptTokens: 0, completionTokens: 0 } } })
        expect(t.reached.chat).toBe(0)
    })

    it("MODEL-3 malformed: prose where JSON is asked -> an ANSWER of prose (the caller's own reading judges it), costing nothing", async () => {
        const t = setup()
        await t.pick(MODEL_SANDBOX_CASE.malformed)
        const tried = await doorOver(t.runnerFor(FACTS)).attempt(REQUEST)
        expect(tried).toMatchObject({ ok: true, answer: { text: MODEL_SANDBOX_MALFORMED_TEXT, model: MODEL_SANDBOX_MODEL, usage: { promptTokens: 0, costUsd: 0 } } })
    })

    it("MODEL-4 times out: the call throws the client's `TimeoutError` -> failed try `timeout`; logged as thrown under the purpose", async () => {
        const t = setup()
        await t.pick(MODEL_SANDBOX_CASE.timedOut)
        await expect(doorOver(t.runnerFor(FACTS)).attempt(REQUEST)).resolves.toEqual({ ok: false, failure: "timeout" })
        expect((await t.sandbox.calls(ACCOUNT)).map((one) => [one.operation, one.result])).toEqual([
            [FACTS, { outcome: "threw", error: "TimeoutError" }],
        ])
    })

    it("MODEL-5 provider error 503 -> failed try `provider`", async () => {
        const t = setup()
        await t.pick(MODEL_SANDBOX_CASE.providerError)
        await expect(doorOver(t.runnerFor(FACTS)).attempt(REQUEST)).resolves.toEqual({ ok: false, failure: "provider" })
        expect((await t.sandbox.calls(ACCOUNT))[0]?.result).toEqual({ outcome: "threw", error: "InternalServerError" })
    })

    it("MODEL-6 cut at the token limit: finish `length`, half a JSON object -> failed try `length` with a zero spend", async () => {
        const t = setup()
        await t.pick(MODEL_SANDBOX_CASE.cut)
        const tried = await doorOver(t.runnerFor(FACTS)).attempt(REQUEST)
        expect(tried).toMatchObject({ ok: false, failure: "length", spent: { model: MODEL_SANDBOX_MODEL, usage: { completionTokens: 0 } } })
    })

    it("MODEL-7 cannot: the node protocol's own `confused` object, read as an answer", async () => {
        const t = setup()
        await t.pick(MODEL_SANDBOX_CASE.confused)
        const tried = await doorOver(t.runnerFor(PURPOSE)).attempt(REQUEST)
        expect(tried.ok && JSON.parse(tried.answer.text)).toEqual({ confused: MODEL_SANDBOX_CONFUSION })
    })

    it("STICKY: every try of a call and every later call sees the picked case until it is changed; picking MODEL-1 goes back", async () => {
        const t = setup()
        const door = doorOver(t.runnerFor(FACTS))
        await t.pick(MODEL_SANDBOX_CASE.timedOut)
        const failures = [await door.attempt(REQUEST), await door.attempt(REQUEST), await door.attempt(REQUEST)]
        expect(failures.map((one) => (one.ok ? "ok" : one.failure))).toEqual(["timeout", "timeout", "timeout"])
        await t.pick(MODEL_SANDBOX_CASE.passed)
        await expect(door.attempt(REQUEST)).resolves.toMatchObject({ ok: true })
        expect(t.reached.chat).toBe(1)
    })

    it("a case picked for ONE PURPOSE holds for that purpose only and wins over the every-call pick", async () => {
        const t = setup()
        await t.pick(MODEL_SANDBOX_CASE.providerError)
        await t.pick(MODEL_SANDBOX_CASE.timedOut, FACTS)
        await expect(doorOver(t.runnerFor(FACTS)).attempt(REQUEST)).resolves.toEqual({ ok: false, failure: "timeout" })
        await expect(doorOver(t.runnerFor(PURPOSE)).attempt(REQUEST)).resolves.toEqual({ ok: false, failure: "provider" })
        await t.pick(MODEL_SANDBOX_CASE.passed)
        await expect(doorOver(t.runnerFor(PURPOSE)).attempt(REQUEST)).resolves.toMatchObject({ ok: true })
        await expect(doorOver(t.runnerFor(FACTS)).attempt(REQUEST)).resolves.toEqual({ ok: false, failure: "timeout" })
    })

    it("is deterministic: the same case answers the same reply on every call", async () => {
        const t = setup()
        await t.pick(MODEL_SANDBOX_CASE.malformed)
        const one = await t.runnerFor(FACTS).chat(REQUEST)
        const two = await t.runnerFor(FACTS).chat(REQUEST)
        expect(two).toEqual(one)
    })

    it("embeddings are no model call of the cases: they go to the endpoint", async () => {
        const t = setup()
        await t.pick(MODEL_SANDBOX_CASE.timedOut)
        await expect(t.runnerFor(FACTS).embed({ input: ["a"], dimensions: 2, timeoutMs: 1000 })).resolves.toEqual([[0.1, 0.2]])
        expect(await t.sandbox.calls(ACCOUNT)).toEqual([])
    })
})

describe("ModelSandboxRunnerService: tries of an agent turn (the try's client, invoked)", () => {
    it("building the try's client asks nothing and logs nothing: the case is decided when it is invoked", async () => {
        const t = setup()
        await t.runnerFor(PURPOSE).turnModel(TURN)
        expect(await t.sandbox.calls(ACCOUNT)).toEqual([])
    })

    it("MODEL-1: the try passes to the endpoint's client with the same messages", async () => {
        const t = setup()
        const message = await turnTry(t.runnerFor(PURPOSE))
        expect(message).toMatchObject({ content: "from the endpoint" })
        expect(t.reached.turn).toBe(1)
        expect((await t.sandbox.calls(ACCOUNT))[0]?.result).toEqual({ outcome: "answered", value: { case: MODEL_SANDBOX_CASE.passed, passed: true } })
    })

    it("MODEL-4: the try throws `TimeoutError` -> the door reads `timeout`; one logged call per try", async () => {
        const t = setup()
        await t.pick(MODEL_SANDBOX_CASE.timedOut, PURPOSE)
        const door = doorOver(t.runnerFor(PURPOSE))
        const thrown = await turnTry(t.runnerFor(PURPOSE)).then(
            () => null,
            (cause: unknown) => cause,
        )
        expect(door.failureOfThrow(thrown)).toBe("timeout")
        await turnTry(t.runnerFor(PURPOSE)).catch(() => undefined)
        expect((await t.sandbox.calls(ACCOUNT, PURPOSE)).map((one) => one.result)).toEqual([
            { outcome: "threw", error: "TimeoutError" },
            { outcome: "threw", error: "TimeoutError" },
        ])
        expect(t.reached.turn).toBe(0)
    })

    it("MODEL-2 / -3 / -6 / -7: what the door's `readTurn` reads of each try", async () => {
        const t = setup()
        const door = doorOver(t.runnerFor(PURPOSE))
        const readOf = async (caseId: ModelSandboxCaseId) => {
            await t.pick(caseId, PURPOSE)
            return door.readTurn(await turnTry(t.runnerFor(PURPOSE)), TURN)
        }
        expect(await readOf(MODEL_SANDBOX_CASE.refused)).toEqual({ ok: false, failure: "empty" })
        expect(await readOf(MODEL_SANDBOX_CASE.malformed)).toMatchObject({ ok: true, model: MODEL_SANDBOX_MODEL, toolCalls: 0 })
        expect(await readOf(MODEL_SANDBOX_CASE.cut)).toMatchObject({ ok: false, failure: "length" })
        expect(await readOf(MODEL_SANDBOX_CASE.confused)).toMatchObject({ ok: true, toolCalls: 1, usage: { promptTokens: 0 } })
        await t.pick(MODEL_SANDBOX_CASE.confused, PURPOSE)
        const said = await turnTry(t.runnerFor(PURPOSE))
        expect(said).toMatchObject({ tool_calls: [{ name: "confused", args: MODEL_SANDBOX_CONFUSION }] })
    })

    it("binds tools like the endpoint's client and passes them on to it", async () => {
        const t = setup()
        const client = await t.runnerFor(PURPOSE).turnModel(TURN)
        expect(client.bindTools).toBeDefined()
        const bound = client.bindTools?.([{ type: "function", function: { name: "done", parameters: {} } }])
        await expect(bound?.invoke([new HumanMessage("hi")])).resolves.toMatchObject({ content: "from the endpoint" })
    })
})

describe("ModelSandboxRunnerService: the sandbox law", () => {
    it("a LIVE account is refused PROVIDER_SANDBOX_LIVE_ACCOUNT, and nothing reaches the endpoint", async () => {
        const t = setup()
        const live = t.service.runnerOf({ ...ACCOUNT, sandbox: false }, FACTS, t.endpoint)
        await expect(live.chat(REQUEST)).rejects.toMatchObject({ code: ProviderSandboxErrorCode.LiveAccount })
        expect(t.reached.chat).toBe(0)
    })

    it("switch off (production): refused PROVIDER_SANDBOX_OFF", async () => {
        const { sandbox } = sandboxServiceOff(ACCOUNT)
        const { endpoint, reached } = endpointOf()
        const runner = new ModelSandboxRunnerService(sandbox).runnerOf(ACCOUNT, FACTS, endpoint)
        await expect(runner.chat(REQUEST)).rejects.toMatchObject({ code: ProviderSandboxErrorCode.Off })
        expect(reached.chat).toBe(0)
    })

    it("the catalogue: ids MODEL-<n> unique, every case outbound on `call`, exactly one default (MODEL-1)", () => {
        const ids = MODEL_SANDBOX_CATALOGUE.cases.map((one) => one.id)
        expect(ids).toEqual(["MODEL-1", "MODEL-2", "MODEL-3", "MODEL-4", "MODEL-5", "MODEL-6", "MODEL-7"])
        expect(new Set(ids).size).toBe(ids.length)
        expect(MODEL_SANDBOX_CATALOGUE.cases.every((one) => one.operation === MODEL_CALL_OPERATION && one.inbound === undefined)).toBe(true)
        expect(MODEL_SANDBOX_CATALOGUE.cases.filter((one) => one.default === true).map((one) => one.id)).toEqual(["MODEL-1"])
        expect(MODEL_SANDBOX_CATALOGUE.provider).toBe("model")
    })

    it("ZERO NETWORK: takes only the frame; no integration client, no network import", () => {
        expect(ModelSandboxRunnerService.length).toBe(1)
        for (const file of [__filename.replace(".spec.ts", ".ts"), __filename.replace("-runner.service.spec.ts", "-chat.adapter.ts"), __filename.replace("-runner.service.spec.ts", "-replies.policy.ts")]) {
            const source = readFileSync(file, "utf8")
            expect(source).not.toContain("@modules/integrations")
            expect(source).not.toContain("http")
        }
    })
})
