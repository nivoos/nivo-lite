import { callsDataOf } from "./sandbox.calls"
import { purposeTextOf, SANDBOX_SCOPE_ALL, scopeOf } from "./sandbox.purposes"
import type { SandboxWords } from "./sandbox.words"

const words: SandboxWords = {
    latest: (values) => values,
    next: (operation, caseId) => `${operation}:${caseId}`,
    number: (value) => String(value),
    time: () => "t",
    inbound: "inbound",
    waitingWhat: (verbs) => verbs,
    waitingWhatAny: "any",
    agentsLine: (names) => names.join(","),
    defaultName: (provider) => provider,
    providerName: (provider) => provider,
    providerLogo: () => null,
    purposeKnown: (purpose) => (purpose === "document_read:extract" ? "extract-word" : null),
    purposeNode: "node-word",
    purposeOther: "other-word",
    scopeAll: "all-word",
    scopeAllHint: "all-hint",
}

const call = (id: string, key: string, over: Partial<{ operation: string; outcome: string; requestJson: string; error: string | null }> = {}) => ({
    id,
    at: "2026-11-14T10:00:00Z",
    key,
    operation: "call",
    outcome: "passed",
    requestJson: "{}",
    answerJson: null,
    error: null,
    ...over,
})

describe("purposeTextOf", () => {
    it("words a purpose the app declares by its own words, with no hint", () => {
        expect(purposeTextOf("document_read:extract", words)).toEqual({ label: "extract-word", hint: null })
    })

    it("says the generic word for a graph node's agent turn and for any other call, with the key as the hint (never the key alone)", () => {
        expect(purposeTextOf("chatbot.answer:agent", words)).toEqual({ label: "node-word", hint: "chatbot.answer:agent" })
        expect(purposeTextOf("engine:other", words)).toEqual({ label: "other-word", hint: "engine:other" })
    })
})

describe("scopeOf", () => {
    const calls = [call("1", "call"), call("2", "chatbot.answer:agent"), call("3", "document_read:extract"), call("4", "chatbot.answer:agent")]

    it("is none for any provider but the model, and while the log is not read", () => {
        expect(scopeOf("sepay", calls, null, words)).toBeNull()
        expect(scopeOf("model", undefined, null, words)).toBeNull()
    })

    it("offers every call first, then each purpose of the log once, newest first, the every-call key being none", () => {
        const scope = scopeOf("model", calls, null, words)
        expect(scope?.selectedId).toBe(SANDBOX_SCOPE_ALL)
        expect(scope?.choices.map((choice) => choice.id)).toEqual([SANDBOX_SCOPE_ALL, "chatbot.answer:agent", "document_read:extract"])
        expect(scope?.choices[0]).toMatchObject({ label: "all-word", hint: "all-hint" })
    })

    it("keeps the chosen purpose while the log holds it, else falls back to every call", () => {
        expect(scopeOf("model", calls, "document_read:extract", words)?.selectedId).toBe("document_read:extract")
        expect(scopeOf("model", calls, "gone:agent", words)?.selectedId).toBe(SANDBOX_SCOPE_ALL)
    })
})

describe("callsDataOf on the model account", () => {
    it("names the purpose in words (its key only as a hint) instead of the raw key", () => {
        const data = callsDataOf([call("1", "chatbot.answer:agent"), call("2", "document_read:extract")], 10, "model", words)
        expect(data.rows[0]?.line).toBe("extract-word · t")
        expect(data.rows[1]?.line).toBe("node-word · chatbot.answer:agent · t")
    })

    it("keeps the key for another provider", () => {
        expect(callsDataOf([call("1", "renew")], 10, "inet", words).rows[0]?.line).toBe("renew · t")
    })
})
