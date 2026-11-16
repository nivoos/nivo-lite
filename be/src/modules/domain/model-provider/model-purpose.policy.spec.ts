import { modelPurposeOf } from "./model-purpose.policy"

describe("modelPurposeOf", () => {
    it("the call's own purpose first", () => {
        expect(modelPurposeOf("chatbot.answer:agent", { kind: "node", stepKey: "answer" })).toBe("chatbot.answer:agent")
    })

    it("else the work scope's kind and step, else its kind", () => {
        expect(modelPurposeOf(null, { kind: "document_read", stepKey: "triage" })).toBe("document_read:triage")
        expect(modelPurposeOf(null, { kind: "learning", stepKey: null })).toBe("learning")
    })

    it("else `call`; a blank purpose counts as none; at most 200 characters", () => {
        expect(modelPurposeOf(null, null)).toBe("call")
        expect(modelPurposeOf("  ", null)).toBe("call")
        expect(modelPurposeOf("x".repeat(300), null)).toHaveLength(200)
    })
})
