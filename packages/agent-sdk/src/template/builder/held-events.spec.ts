import { z } from "zod"
import { checkTemplateNode } from "./template-example"
import { defineTemplateNode, templateNodeProblems } from "./template-node"
import type { TemplateNodeShape } from "./template-node"
import { TemplateDefinitionError } from "./template-problems"

// SDK-DECL (E-FIX12 rule A-7): a node DECLARES that its step reads the events of the run's subject held behind the run
// (`readsHeldEvents`). Generic words: the declaration names no data source, so it holds for customer lines and for records alike.
const words = { vi: "Nút thử nghiệm của bộ kiểm tra.", en: "A test node of the checks." }

/** Chat-shaped: reads the burst of lines held behind its run (`ctx.run.queue`), oldest first, as one text. */
const hearLines = defineTemplateNode({
    id: "test.hear-lines",
    title: { key: "t" },
    description: words,
    tools: [],
    mode: "auto",
    accounts: [],
    readsHeldEvents: true,
    input: z.object({}),
    output: z.object({ text: z.string().max(500) }),
    run: (_input, ctx) =>
        Promise.resolve({
            text: ctx.run.queue
                .map((event) => {
                    const data = event["data"]
                    return typeof data === "object" && data !== null && !Array.isArray(data) && typeof data["text"] === "string" ? data["text"] : ""
                })
                .join("\n"),
        }),
    examples: [
        {
            name: "three lines held behind a stopped run are heard together, oldest first",
            params: {},
            input: {},
            queue: [{ data: { text: "How much" } }, { data: { text: "for roses" } }, { data: { text: "today?" } }],
            output: { text: "How much\nfor roses\ntoday?" },
        },
    ],
})

/** A second kind: a subject that is not a person (a bank transaction's `each` credits), whose held events are records of money, not lines. */
const creditBatch = defineTemplateNode({
    id: "test.credit-batch",
    title: { key: "t" },
    description: words,
    tools: [],
    mode: "auto",
    accounts: [],
    readsHeldEvents: true,
    input: z.object({}),
    output: z.object({ total: z.number() }),
    run: (_input, ctx) =>
        Promise.resolve({
            total: ctx.run.queue.reduce((sum, event) => {
                const data = event["data"]
                const amount = typeof data === "object" && data !== null && !Array.isArray(data) ? data["amount"] : 0
                return sum + (typeof amount === "number" ? amount : 0)
            }, 0),
        }),
    examples: [
        {
            name: "two credits of one transaction held behind its run are read together",
            params: {},
            input: {},
            subject: { kind: "transaction", id: "t-1" },
            queue: [{ verb: "bank.credit", data: { amount: 5 } }, { verb: "bank.credit", data: { amount: 7 } }],
            output: { total: 12 },
        },
    ],
})

/** A plain step: declares nothing, so a visit of it after a person's decision takes no held event. */
const plain = defineTemplateNode({
    id: "test.plain-step",
    title: { key: "t" },
    description: words,
    tools: [],
    mode: "auto",
    accounts: [],
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    run: () => Promise.resolve({ ok: true }),
    examples: [{ name: "does its one thing", params: {}, input: {}, output: { ok: true } }],
})

describe("a node declares that its step reads the run's held events", () => {
    it("chat-shaped and a non-person subject both declare it, and both conform (their examples carry the held events they read)", async () => {
        expect(hearLines.readsHeldEvents).toBe(true)
        expect(creditBatch.readsHeldEvents).toBe(true)
        expect(await checkTemplateNode(hearLines)).toEqual([])
        expect(await checkTemplateNode(creditBatch)).toEqual([])
    })

    it("a node that says nothing declares nothing (the safe side: no step takes held events unless its node declares it)", async () => {
        expect(plain.readsHeldEvents).toBeUndefined()
        expect(await checkTemplateNode(plain)).toEqual([])
    })
})

describe("NODE_HELD_READS_INVALID: only `true` is written", () => {
    const shape = (readsHeldEvents: unknown): TemplateNodeShape => ({
        id: "test.shape",
        description: words,
        tools: [],
        mode: "auto",
        accounts: [],
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        readsHeldEvents,
        examples: [{ name: "one" }],
    })

    it.each<readonly [string, unknown, ReadonlyArray<string>]>([
        ["absent", undefined, []],
        ["true", true, []],
        ["false: absent already says no, a second way to say it", false, ["NODE_HELD_READS_INVALID"]],
        ["a word", "yes", ["NODE_HELD_READS_INVALID"]],
        ["a number", 1, ["NODE_HELD_READS_INVALID"]],
        ["null", null, ["NODE_HELD_READS_INVALID"]],
    ])("%s", (_name, written, codes) => {
        expect(templateNodeProblems(shape(written)).map((problem) => problem.code)).toEqual(codes)
    })

    it("defineTemplateNode refuses it at module load, naming the node member", () => {
        const refused = (): unknown =>
            defineTemplateNode({ ...plain, readsHeldEvents: false as never, run: () => Promise.resolve({ ok: true }) })
        expect(refused).toThrow(TemplateDefinitionError)
        expect(refused).toThrow(expect.objectContaining({ problems: [expect.objectContaining({ code: "NODE_HELD_READS_INVALID", at: "test.plain-step.readsHeldEvents" })] }))
    })
})
