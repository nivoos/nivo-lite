import { Test } from "@nestjs/testing"
import { STOCK_QUESTION_VI } from "@tests/fixtures/i18n/ai-tasks-spec.messages"
import { nodeMessagesOf, nodeMetaOf, nodePromptOf } from "./node-prompt.policy"
import { ITEMS_SCHEMA } from "@tests/fixtures/builders/ai-tasks-service.builder"

const ASK = { purpose: "intent.classify:read", instructions: "Rules", input: { text: "hi" } }

const SUBJECT = Symbol("node-prompt.policy")

const build = async () => {
    const moduleRef = await Test.createTestingModule({
        providers: [{ provide: SUBJECT, useValue: { nodeMessagesOf, nodeMetaOf, nodePromptOf } }],
    }).compile()
    return moduleRef.get<typeof import("./node-prompt.policy")>(SUBJECT)
}

describe("node-prompt policy", () => {
    let policy: typeof import("./node-prompt.policy")

    beforeAll(async () => {
        policy = await build()
    })

    it("sends the instructions as the system message and the input as JSON in the user message", () => {
        expect(policy.nodeMessagesOf(ASK)).toEqual([
            { role: "system", content: "Rules", cacheMark: true },
            { role: "user", content: '{"text":"hi"}' },
        ])
        expect(policy.nodeMessagesOf({ ...ASK, input: undefined })[1]).toEqual({ role: "user", content: "null" })
    })

    it("names the answer's members and their types in the system message of a structured call", () => {
        const [system] = policy.nodeMessagesOf(ASK, ITEMS_SCHEMA)

        expect(system?.content.startsWith("Rules\n\nAnswer with one JSON object")).toBe(true)
        expect(system?.content).toContain('"items":')
        expect(system?.content).toContain('"amount_vnd":')
        expect(system?.content).toContain('"type":["number","null"]')
    })

    it("keeps the instructions alone for a free-text call", () => {
        expect(policy.nodeMessagesOf(ASK)[0]).toEqual({ role: "system", content: "Rules", cacheMark: true })
    })

    it("attaches the pictures of the call to the user message, and leaves the key out when there are none", () => {
        const withImages = policy.nodeMessagesOf({ ...ASK, images: ["https://files/a.jpg"] })
        expect(withImages[1]).toEqual({ role: "user", content: '{"text":"hi"}', images: ["https://files/a.jpg"] })
        expect(policy.nodeMessagesOf({ ...ASK, images: [] })[1]).not.toHaveProperty("images")
    })

    it("prompt cache: opens two calls of a step with the same system message whatever their words and data for this call", () => {
        const first = policy.nodePromptOf({ ...ASK, input: { thread: ["hi"], at: "2026-11-10T01:00:00Z" } }, ITEMS_SCHEMA)
        const second = policy.nodePromptOf(
            { ...ASK, volatile: "The founder answered.", input: { thread: ["hi", STOCK_QUESTION_VI], leadId: "lead-9" } },
            ITEMS_SCHEMA,
        )

        expect(second.stable).toEqual(first.stable)
        expect(JSON.stringify(second.stable)).toBe(JSON.stringify(first.stable))
        expect(first.stable).toHaveLength(1)
        expect(first.volatile).toEqual([{ role: "user", content: '{"thread":["hi"],"at":"2026-11-10T01:00:00Z"}' }])
        expect(second.volatile).toEqual([
            { role: "system", content: "The founder answered." },
            { role: "user", content: JSON.stringify({ thread: ["hi", STOCK_QUESTION_VI], leadId: "lead-9" }) },
        ])
        // What is sent is the stable part, then the volatile one.
        expect(policy.nodeMessagesOf({ ...ASK, volatile: "V" })).toEqual([
            { role: "system", content: "Rules", cacheMark: true },
            { role: "system", content: "V" },
            { role: "user", content: '{"text":"hi"}' },
        ])
    })

    it("meters the call as engine work of the namespace of the node", () => {
        expect(policy.nodeMetaOf(ASK)).toEqual({ kind: "engine", module: "intent" })
    })
})

describe("node-prompt policy: the four layers of a node's call (PROMPT-CACHE)", () => {
    const LAYERED = { ...ASK, instructions: "STEP", opening: { craft: "CRAFT TOOLS", policies: "WORKSPACE POLICIES" } }

    it("sends L1, L2 and L3 as three marked system messages, in that order, each text as the host wrote it", () => {
        expect(nodePromptOf(LAYERED).stable).toEqual([
            { role: "system", content: "CRAFT TOOLS", cacheMark: true },
            { role: "system", content: "WORKSPACE POLICIES", cacheMark: true },
            { role: "system", content: "STEP", cacheMark: true },
        ])
        expect(nodePromptOf(LAYERED, ITEMS_SCHEMA).stable[2]?.content.startsWith("STEP\n\nAnswer with one JSON object")).toBe(true)
    })

    it("sends no message and no mark for a layer with no text: no policies, no craft, no opening", () => {
        expect(nodePromptOf({ ...LAYERED, opening: { craft: "CRAFT TOOLS", policies: "" } }).stable).toEqual([
            { role: "system", content: "CRAFT TOOLS", cacheMark: true },
            { role: "system", content: "STEP", cacheMark: true },
        ])
        expect(nodePromptOf({ ...LAYERED, opening: { craft: "", policies: "WORKSPACE POLICIES" } }).stable).toHaveLength(2)
        expect(nodePromptOf(ASK).stable).toEqual([{ role: "system", content: "Rules", cacheMark: true }])
    })

    it("changes L2 alone when a workspace policy changes: L1, L3 and the volatile part keep their bytes", () => {
        const before = nodePromptOf(LAYERED, ITEMS_SCHEMA)
        const after = nodePromptOf({ ...LAYERED, opening: { craft: "CRAFT TOOLS", policies: "WORKSPACE POLICIES, CHANGED" } }, ITEMS_SCHEMA)
        expect(after.stable[0]).toEqual(before.stable[0])
        expect(after.stable[1]).not.toEqual(before.stable[1])
        expect(after.stable[2]).toEqual(before.stable[2])
        expect(after.volatile).toEqual(before.volatile)
    })

    it("appends each earlier turn of a loop as its own user message after the input: a later turn only adds at the end", () => {
        const first = nodeMessagesOf({ ...LAYERED, input: { input: 1, turnsLeft: 2 } })
        const second = nodeMessagesOf({ ...LAYERED, input: { input: 1, turnsLeft: 2 }, turns: [{ tool: "t", ok: true, turnsLeft: 1 }] })
        const third = nodeMessagesOf({
            ...LAYERED,
            input: { input: 1, turnsLeft: 2 },
            turns: [
                { tool: "t", ok: true, turnsLeft: 1 },
                { done: "refused", turnsLeft: 0 },
            ],
        })
        expect(second.slice(0, first.length)).toEqual(first)
        expect(third.slice(0, second.length)).toEqual(second)
        expect(third.at(-1)).toEqual({ role: "user", content: '{"done":"refused","turnsLeft":0}' })
    })
})
