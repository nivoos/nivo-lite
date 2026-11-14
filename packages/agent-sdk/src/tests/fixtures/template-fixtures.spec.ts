import { sampleVocabulary, graphOf, nodeOf } from "./index"

describe("the testing kit", () => {
    it("builds a whole graph and a vocabulary with a fake kind", () => {
        expect(graphOf().nodes.map((node) => node.key)).toEqual(["start", "decide", "act", "ask", "end"])
        expect(sampleVocabulary().hasKind("fake")).toBe(true)
        expect(sampleVocabulary().hasProvider("fake-provider")).toBe(true)
    })

    it("builds a node with every answer filled, and lets a spec change any of them", () => {
        expect(nodeOf().key).toBe("act")
        expect(nodeOf({ key: "other" }).key).toBe("other")
    })
})
