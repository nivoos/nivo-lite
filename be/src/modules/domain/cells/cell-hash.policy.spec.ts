import { askToPayNode, leadIntakeGraph, paymentGraph, sourceHashOf, ASK_TO_PAY_SOURCE } from "@tests/fixtures/builders/cells-storage.builder"
import { canonicalJsonOf, definitionHashOf, documentHashOf, graphRefTextOf, refTextOf, sha256Of } from "./cell-hash.policy"
import type { DefinitionContent } from "./cell-hash.policy"

const contentOf = (): DefinitionContent => {
    const node = askToPayNode({ id: "s-1", sha256: sourceHashOf(ASK_TO_PAY_SOURCE) })
    return { ...node, sourceSha256: node.source?.sha256 ?? null }
}

describe("sha256Of", () => {
    it("hashes the UTF-8 bytes of a text to lowercase hex", () => {
        expect(sha256Of("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    })
})

describe("canonicalJsonOf", () => {
    it("sorts the members of every object, keeps array order and drops undefined members", () => {
        expect(canonicalJsonOf({ b: 1, a: { d: [3, 2], c: undefined }, e: null })).toBe('{"a":{"d":[3,2]},"b":1,"e":null}')
    })

    it("writes the same text whatever the member order", () => {
        expect(canonicalJsonOf({ x: 1, y: 2 })).toBe(canonicalJsonOf({ y: 2, x: 1 }))
    })

    it("writes a scalar as JSON and an undefined root as null", () => {
        expect([canonicalJsonOf("a"), canonicalJsonOf(7), canonicalJsonOf(true), canonicalJsonOf(undefined)]).toEqual(['"a"', "7", "true", "null"])
    })
})

describe("definitionHashOf", () => {
    it("is stable for equal content and a 64 hex sha256", () => {
        expect(definitionHashOf(contentOf())).toMatch(/^[0-9a-f]{64}$/)
        expect(definitionHashOf(contentOf())).toBe(definitionHashOf(contentOf()))
    })

    it("changes with any member that makes the version what it is", () => {
        const base = definitionHashOf(contentOf())
        const changed = [
            { ...contentOf(), key: "demo.other" },
            { ...contentOf(), version: 2 },
            { ...contentOf(), body: { entry: "translate" } },
            { ...contentOf(), semantics: { mutates: false } },
            { ...contentOf(), sourceSha256: sha256Of("other source") },
            { ...contentOf(), examples: [] },
        ].map(definitionHashOf)
        expect(changed.filter((hash) => hash === base)).toEqual([])
        expect(new Set(changed).size).toBe(changed.length)
    })

    it("does not cover the review state or the review ref", () => {
        const node = askToPayNode({ id: "s-1", sha256: sourceHashOf(ASK_TO_PAY_SOURCE) })
        const retired = { ...node, reviewState: "retired" as const, reviewRef: "other@cccc", sourceSha256: node.source?.sha256 ?? null }
        expect(definitionHashOf(retired)).toBe(definitionHashOf(contentOf()))
    })
})

describe("documentHashOf", () => {
    it("is stable and differs between the two fixture graphs", () => {
        expect(documentHashOf(paymentGraph().document)).toBe(documentHashOf(paymentGraph().document))
        expect(documentHashOf(paymentGraph().document)).not.toBe(documentHashOf(leadIntakeGraph().document))
    })

    it("covers the vars declaration", () => {
        const graph = leadIntakeGraph()
        const withoutVars = { start: graph.document.start, triggers: graph.document.triggers, steps: graph.document.steps }
        expect(documentHashOf(graph.document)).not.toBe(documentHashOf(withoutVars))
    })
})

describe("ref texts", () => {
    it("writes kind:key@version and graph:key@version", () => {
        expect(refTextOf({ kind: "node", key: "demo.ask-to-pay", version: 2 })).toBe("node:demo.ask-to-pay@2")
        expect(graphRefTextOf({ key: "demo.payment", version: 1 })).toBe("graph:demo.payment@1")
    })
})
