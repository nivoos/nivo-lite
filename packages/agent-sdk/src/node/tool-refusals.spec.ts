import { z } from "zod"
import { SdkDefinitionError } from "../block/definition-error"
import { defineEffect, defineTool } from "./effect"
import { finalRefusalsOf, refusalProblemsOf } from "./tool-refusals"

/** The same two members the engine's native tool specs carry (E-FIX12 rule A-5), declared by a PLUGIN's tool or effect. */
const base = { title: { key: "t" }, args: z.object({ to: z.string().max(100) }), result: z.object({ id: z.string().max(100) }) }

describe("a plugin's tool declares its final refusals (same name, same checks as a native tool spec)", () => {
    it("a chat-shaped write: a private plugin's line send declares `opted_out` final, a subset of its own refusals", () => {
        const send = defineTool({
            ...base,
            id: "shop.line.send",
            mutates: true,
            refusals: ["opted_out", "window_closed"],
            finalRefusals: ["opted_out"],
        })
        expect(finalRefusalsOf(send)).toEqual(["opted_out"])
        expect(send.refusals).toEqual(["opted_out", "window_closed"])
    })

    it("a second kind, a provider write of a private plugin: a registration declares `already_exists` final; an effect the same", () => {
        const register = defineTool({
            ...base,
            id: "registry.domain.register",
            mutates: true,
            refusals: ["already_exists", "rejected"],
            finalRefusals: ["already_exists"],
        })
        expect(finalRefusalsOf(register)).toEqual(["already_exists"])
        const renewal = defineEffect({
            id: "registry.domain.renew",
            title: { key: "e" },
            payload: z.object({ domain: z.string().max(100) }),
            refusals: ["not_renewable"],
            finalRefusals: ["not_renewable"],
        })
        expect(finalRefusalsOf(renewal)).toEqual(["not_renewable"])
    })

    it("a definition that declares none declares none final (absent = a stop, never guessed)", () => {
        const quiet = defineTool({ ...base, id: "shop.line.quote", mutates: true })
        expect(finalRefusalsOf(quiet)).toEqual([])
        expect(finalRefusalsOf(defineEffect({ id: "shop.line.note", title: { key: "e" }, payload: z.object({}) }))).toEqual([])
    })
})

describe("load-time checks of refusal declarations: a bad one fails its own package", () => {
    const refusedWith = (make: () => unknown): { code: string; at: string } => {
        try {
            make()
        } catch (error) {
            if (error instanceof SdkDefinitionError) return { code: error.code, at: String(error.params?.at) }
            throw error
        }
        throw new Error("the definition was accepted")
    }

    it("TOOL_FINAL_REFUSAL_UNKNOWN: a final refusal that is not one of the tool's own (a tool; an effect; a tool with none declared)", () => {
        expect(refusedWith(() => defineTool({ ...base, id: "shop.line.send", mutates: true, refusals: ["opted_out"], finalRefusals: ["gone"] }))).toEqual({
            code: "TOOL_FINAL_REFUSAL_UNKNOWN",
            at: "shop.line.send:gone",
        })
        expect(refusedWith(() => defineTool({ ...base, id: "shop.line.send", mutates: true, finalRefusals: ["opted_out"] })).code).toBe(
            "TOOL_FINAL_REFUSAL_UNKNOWN",
        )
        expect(
            refusedWith(() =>
                defineEffect({ id: "registry.domain.renew", title: { key: "e" }, payload: z.object({}), refusals: ["a_b"], finalRefusals: ["c_d"] }),
            ),
        ).toEqual({ code: "TOOL_FINAL_REFUSAL_UNKNOWN", at: "registry.domain.renew:c_d" })
    })

    it("TOOL_FINAL_REFUSAL_ON_READ: a final refusal on a tool that does not mutate (a read is never a failed act)", () => {
        expect(
            refusedWith(() => defineTool({ ...base, id: "shop.line.list", mutates: false, refusals: ["not_found"], finalRefusals: ["not_found"] })),
        ).toEqual({ code: "TOOL_FINAL_REFUSAL_ON_READ", at: "shop.line.list:not_found" })
    })

    it("TOOL_FINAL_REFUSAL_RESERVED: `declined` is the engine's own answer to a person's decline, never a tool's", () => {
        expect(refusedWith(() => defineTool({ ...base, id: "shop.line.send", mutates: true, refusals: ["declined"], finalRefusals: ["declined"] })).code).toBe(
            "TOOL_FINAL_REFUSAL_RESERVED",
        )
        expect(refusedWith(() => defineTool({ ...base, id: "shop.line.send", mutates: true, refusals: ["declined"] })).code).toBe("TOOL_FINAL_REFUSAL_RESERVED")
    })

    it("TOOL_REFUSAL_CODE_MALFORMED: a code that is not lower snake case (words, spaces, a capital, empty)", () => {
        for (const code of ["Opted out", "optedOut", "", "9lives"])
            expect(refusedWith(() => defineTool({ ...base, id: "shop.line.send", mutates: true, refusals: [code] })).code).toBe("TOOL_REFUSAL_CODE_MALFORMED")
    })

    it("lists every problem, in a stable order, without throwing (the pure reader)", () => {
        expect(refusalProblemsOf("x.y", { refusals: ["A"], finalRefusals: ["b"] }, false).map((problem) => problem.code)).toEqual([
            "TOOL_REFUSAL_CODE_MALFORMED",
            "TOOL_FINAL_REFUSAL_UNKNOWN",
            "TOOL_FINAL_REFUSAL_ON_READ",
        ])
        expect(refusalProblemsOf("x.y", {}, true)).toEqual([])
    })
})
