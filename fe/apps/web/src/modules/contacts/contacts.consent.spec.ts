import { consentOf } from "./contacts.view"

const words = {
    ago: (iso: string) => `ago:${iso}`,
    consentAllowed: "allowed",
    consentRefused: "refused",
    consentSince: (when: string) => `since:${when}`,
    consentBy: (by: "member" | "agent", name: string | null) => `by:${by}:${name ?? "none"}`,
}

describe("consentOf", () => {
    it("says the person may be messaged first when nobody set the mark or it was cleared", () => {
        expect(consentOf(null, words)).toEqual({ isRefused: false, state: "allowed", line: null, reason: null })
        const cleared = { doNotContact: false, at: "2026-11-14T10:00:00Z", by: null, reason: null }
        expect(consentOf(cleared, words)).toMatchObject({ isRefused: false, line: null })
    })

    it("words a refusal with since when, by whom (a member or an agent) and the reason", () => {
        const set = { doNotContact: true, at: "2026-11-14T10:00:00Z", by: { kind: "member", id: "m1", name: "Lan" }, reason: " asked us " }
        expect(consentOf(set, words)).toEqual({
            isRefused: true,
            state: "refused",
            line: "since:ago:2026-11-14T10:00:00Z \u00b7 by:member:Lan",
            reason: "asked us",
        })
        const byAgent = { doNotContact: true, at: null, by: { kind: "agent", id: "a1", name: null }, reason: null }
        expect(consentOf(byAgent, words)).toMatchObject({ line: "by:agent:none", reason: null })
    })

    it("says no line when neither the time nor the author is known", () => {
        expect(consentOf({ doNotContact: true, at: null, by: null, reason: null }, words)).toMatchObject({ isRefused: true, line: null })
    })
})
