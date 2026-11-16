import { ACCOUNT_HALVES, actsAs, halfOfHost, halvesOf, hostsOf } from "./account-halves.policy"

describe("the halves of an account (MAIL-IN rule MI-1)", () => {
    it("declares ONE half: a mailbox `smtp` account may hold the inbound `imap` half, present when its settings are", () => {
        expect(ACCOUNT_HALVES).toEqual([{ host: "smtp", half: "imap", fact: "config" }])
        expect(hostsOf("imap")).toEqual(["smtp"])
        expect(hostsOf("zalo_oa")).toEqual([])
        expect(halfOfHost("smtp")).toEqual({ host: "smtp", half: "imap", fact: "config" })
        expect(halfOfHost("imap")).toBeNull()
    })

    it("an account acts as its own provider and as the provider of every half it holds", () => {
        const mailbox = { provider: "smtp", meta: { config: "{}" } }
        const sender = { provider: "smtp", meta: { config: "" } }

        expect(halvesOf(mailbox)).toEqual(["imap"])
        expect(actsAs(mailbox, "imap")).toBe(true)
        expect(actsAs(mailbox, "smtp")).toBe(true)
        expect(halvesOf(sender)).toEqual([])
        expect(actsAs(sender, "imap")).toBe(false)
        expect(actsAs({ provider: "imap", meta: {} }, "imap")).toBe(true)
        expect(actsAs({ provider: "zalo_oa", meta: { config: "{}" } }, "imap")).toBe(false)
    })
})
