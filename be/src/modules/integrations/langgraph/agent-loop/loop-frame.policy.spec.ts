import { Test } from "@nestjs/testing"
import { SHIPPING_QUESTION_VI, SHIPPING_SNIPPET_VI } from "@tests/fixtures/i18n/langgraph-spec.messages"
import {
    CONFUSED_TOOL,
    DONE_TOOL,
    ONE_CALL_PER_TURN,
    ONE_CALL_REFUSAL,
    TOOL_CALL_REFUSAL,
    TOOL_CALL_REQUIRED,
    openingContentOf,
    openingTextOf,
    stepBoundOf,
    systemContentOf,
    wireToolsOf,
} from "./loop-frame.policy"
import { toolNamesOf } from "./tool-names.policy"

/** The members of the subject under test. */
interface Subject {
    readonly openingTextOf: typeof openingTextOf
    readonly stepBoundOf: typeof stepBoundOf
    readonly wireToolsOf: typeof wireToolsOf
}

const SUBJECT = Symbol("loop-frame.policy")

/** The policy functions, read through the Nest testing module. */
const build = async (): Promise<Subject> => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { openingTextOf, stepBoundOf, wireToolsOf } }],
    }).compile()
    return moduleRef.get<Subject>(SUBJECT)
}

const TOOLS = [
    { name: "order.read", does: "Reads an order.", argsSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
    { name: "order.void", does: { key: "orderVoid" }, argsSchema: null },
]

describe("loop-frame.policy: the tool list of a request", () => {
    it("keeps the order and the schemas of the runner as they are, and closes with done and confused", async () => {
        const tools = (await build()).wireToolsOf(TOOLS, toolNamesOf([], false))

        expect(tools.map((tool) => tool.function.name)).toEqual(["order.read", "order.void", DONE_TOOL, CONFUSED_TOOL])
        expect(tools[0]?.function.parameters).toBe(TOOLS[0]?.argsSchema)
        expect(tools[1]?.function).toEqual({ name: "order.void", description: '{"key":"orderVoid"}', parameters: { type: "object", properties: {} } })
        expect(tools[2]?.function.parameters).toEqual({ type: "object", properties: { output: {} }, required: ["output"] })
        expect(tools[3]?.function.parameters).toEqual({
            type: "object",
            properties: { reason: { type: "string" }, question: { type: ["string", "null"] } },
            required: ["reason", "question"],
        })
    })

    it("is the same text every time it is made, and shows wire names when the run maps them", async () => {
        const policy = await build()
        const plain = toolNamesOf([], false)

        expect(JSON.stringify(policy.wireToolsOf(TOOLS, plain))).toBe(JSON.stringify(policy.wireToolsOf(TOOLS, plain)))
        expect(policy.wireToolsOf(TOOLS, toolNamesOf(["order.read", "order.void"], true)).map((tool) => tool.function.name)).toEqual([
            "order__read",
            "order__void",
            DONE_TOOL,
            CONFUSED_TOOL,
        ])
    })
})

describe("loop-frame.policy: the first user message", () => {
    it("opens with the step, then the volatile rules when the turn has them, then the input as JSON", async () => {
        const policy = await build()

        expect(policy.openingTextOf({ step: "STEP", volatile: " RULES ", input: { input: 1 } })).toBe('STEP\n\nRULES\n\n{"input":1}')
        expect(policy.openingTextOf({ step: "STEP", input: { input: 1 } })).toBe('STEP\n\n{"input":1}')
        expect(policy.openingTextOf({ step: "STEP", volatile: "  ", input: undefined })).toBe("STEP\n\nnull")
    })
})

describe("loop-frame.policy: the refusals the loop makes itself", () => {
    it("have the refusal shape of the runner: a code and bounded words", () => {
        expect(ONE_CALL_REFUSAL.ok).toBe(false)
        expect(ONE_CALL_REFUSAL.refused.code).toBe(ONE_CALL_PER_TURN)
        expect(TOOL_CALL_REFUSAL.ok).toBe(false)
        expect(TOOL_CALL_REFUSAL.refused.code).toBe(TOOL_CALL_REQUIRED)
        expect(Object.keys(ONE_CALL_REFUSAL.refused)).toEqual(["code", "message"])
        expect(Math.max(ONE_CALL_REFUSAL.refused.message.length, TOOL_CALL_REFUSAL.refused.message.length)).toBeLessThanOrEqual(200)
    })

    it("bounds the steps of the library well above what the turns of a step need", async () => {
        expect((await build()).stepBoundOf(12)).toBeGreaterThan(12 * 4)
    })
})

describe("systemContentOf: the system message of a step's agent, L1 and L2 (PROMPT-CACHE)", () => {
    it("is one text part per layer, each with a breakpoint, on Anthropic's client; one text, the layers a blank line apart, on any other", () => {
        expect(systemContentOf("CRAFT", "RULES", "anthropic")).toEqual([
            { type: "text", text: "CRAFT", cache_control: { type: "ephemeral" } },
            { type: "text", text: "RULES", cache_control: { type: "ephemeral" } },
        ])
        expect(systemContentOf("CRAFT", "RULES", "openai")).toBe("CRAFT\n\nRULES")
        expect(systemContentOf("CRAFT", "RULES", "fake")).toBe("CRAFT\n\nRULES")
    })

    it("has no L2 part, and no mark for one, when the workspace has no policies", () => {
        expect(systemContentOf("CRAFT", "", "anthropic")).toEqual([
            { type: "text", text: "CRAFT", cache_control: { type: "ephemeral" } },
        ])
        expect(systemContentOf("CRAFT", undefined, "anthropic")).toHaveLength(1)
        expect(systemContentOf("CRAFT", undefined, "openai")).toBe("CRAFT")
    })
})

describe("openingContentOf: the first user message, L3 then L4 (PROMPT-CACHE)", () => {
    const LOOP = { step: "STEP", volatile: " RULES ", input: { input: 1 } }

    it("ends the step with a breakpoint and sends the try as a part of its own on Anthropic's client", () => {
        expect(openingContentOf(LOOP, "anthropic")).toEqual([
            { type: "text", text: "STEP", cache_control: { type: "ephemeral" } },
            { type: "text", text: 'RULES\n\n{"input":1}' },
        ])
    })

    it("is the one text of openingTextOf on any other client: the same words, no marker", () => {
        expect(openingContentOf(LOOP, "openai")).toBe(openingTextOf(LOOP))
    })

    it("keeps the step part byte for byte whatever the try carries: two runs of one step share L3", () => {
        const first = openingContentOf(LOOP, "anthropic")
        const second = openingContentOf({ ...LOOP, volatile: "", input: { input: 2, thread: ["hi"] } }, "anthropic")
        expect(JSON.stringify(Array.isArray(second) ? second[0] : null)).toBe(JSON.stringify(Array.isArray(first) ? first[0] : null))
    })

    it("carries three marks at most with the system message: with the automatic one, Anthropic's four", () => {
        const marks = [...systemContentOf("CRAFT", "RULES", "anthropic"), ...openingContentOf(LOOP, "anthropic")].filter(
            (part) => typeof part !== "string" && part.cache_control !== undefined,
        )
        expect(marks).toHaveLength(3)
    })
})

describe("loop-frame.policy: a search result never sits in a cached layer", () => {
    const PASSAGE_TOOLS = [
        { name: "nivo.tool.brain.passage.read", does: "Read passages of one document in order.", argsSchema: { type: "object", properties: {} } },
        { name: "nivo.tool.brain.passage.search", does: "Search the documents of the business.", argsSchema: { type: "object", properties: {} } },
    ]
    const SNIPPET = SHIPPING_SNIPPET_VI

    it("keeps the system text and the tool list byte for byte whatever a search answered; the result lives after them only", async () => {
        const subject = await build()
        const names = toolNamesOf(PASSAGE_TOOLS.map((tool) => tool.name), false)
        // Two turns of one step: before any search, and after a search answered (the answer is a tool message, appended to the run).
        const stable = () => JSON.stringify([systemContentOf("CRAFT", "POLICIES", "anthropic"), subject.wireToolsOf(PASSAGE_TOOLS, names)])
        const before = stable()
        const answered = { notice: "…", legs: ["words"], hits: [{ id: "p1", snippet: SNIPPET }], next: null }
        const after = stable()

        expect(after).toBe(before)
        expect(before).not.toContain(SNIPPET)
        // The frame has no member a result could be written into: the step's opening is the step, its volatile rules and its input.
        const opening = subject.openingTextOf({ step: "STEP", volatile: "", input: { message: SHIPPING_QUESTION_VI } })
        expect(opening).not.toContain(SNIPPET)
        expect(JSON.stringify(answered)).toContain(SNIPPET)
    })
})
