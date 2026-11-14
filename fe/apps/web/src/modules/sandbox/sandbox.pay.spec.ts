import { payDataOf, payRefusalOf, payTargetOf, refusedPayData } from "./sandbox.pay"
import type { SandboxWords } from "./sandbox.words"

const words: SandboxWords = {
    latest: (values) => values,
    next: (operation, caseId) => `${operation}:${caseId}`,
    number: (value) => `n${String(value)}`,
    time: (iso) => iso,
    inbound: "inbound",
    waitingWhat: (verbs) => verbs,
    waitingWhatAny: "any",
    agentsLine: (names) => names.join(","),
    defaultName: (provider) => provider,
    providerName: (provider) => provider,
    providerLogo: () => null,
    purposeKnown: () => null,
    purposeNode: "node",
    purposeOther: "other",
    scopeAll: "all",
    scopeAllHint: "all-hint",
}

const terms = {
    link: "link-term",
    account: "account-term",
    amount: "amount-term",
    content: "content-term",
    orderCode: "order-term",
    status: "status-term",
    received: "received-term",
}
const status = {
    open: "open-word",
    paid: "paid-word",
    cancelled: "cancelled-word",
    expired: "expired-word",
    unknown: "unknown-word",
}

const link = {
    linkId: "sbx-payos-c1-000001",
    account: { id: "c1", provider: "payos", label: "shop-payos" },
    amountVnd: 350000,
    content: "DH 12",
    orderCode: "1780000000001",
    status: "open",
    amountReceivedVnd: 0,
    caseIds: ["PAYOS-3"],
    inputs: [{ name: "orderCode", value: "1780000000001" }],
}

describe("payRefusalOf", () => {
    it("names the three typed refusals and nothing else", () => {
        expect(payRefusalOf("PROVIDER_SANDBOX_PAY_LINK_UNKNOWN")).toBe("unknown")
        expect(payRefusalOf("PROVIDER_SANDBOX_LIVE_ACCOUNT")).toBe("live")
        expect(payRefusalOf("PROVIDER_SANDBOX_OFF")).toBe("off")
        expect(payRefusalOf("SOMETHING_ELSE")).toBeUndefined()
        expect(payRefusalOf(undefined)).toBeUndefined()
    })
})

describe("payDataOf", () => {
    it("acts through the link's account with its first case and inputs, and lists the facts of the link", () => {
        const data = payDataOf({ link, words, terms, status })
        expect(data).toMatchObject({ refusal: null, accountId: "c1", caseId: "PAYOS-3" })
        expect(data.inputs).toEqual([{ name: "orderCode", value: "1780000000001" }])
        expect(data.facts.map((fact) => [fact.id, fact.value])).toEqual([
            ["link", "sbx-payos-c1-000001"],
            ["account", "shop-payos"],
            ["amount", "n350000"],
            ["content", "DH 12"],
            ["orderCode", "1780000000001"],
            ["status", "open-word"],
        ])
    })

    it("has no case once the link is closed, words the state and shows what was received", () => {
        const closed = { ...link, status: "paid", amountReceivedVnd: 350000, caseIds: [], inputs: [] }
        const data = payDataOf({ link: closed, words, terms, status })
        expect(data.caseId).toBeNull()
        expect(data.facts.find((fact) => fact.id === "status")?.value).toBe("paid-word")
        expect(data.facts.find((fact) => fact.id === "received")?.value).toBe("n350000")
    })

    it("says the generic word for a state it has no word for, never the raw state", () => {
        const data = payDataOf({ link: { ...link, status: "frozen" }, words, terms, status })
        expect(data.facts.find((fact) => fact.id === "status")?.value).toBe("unknown-word")
    })

    it("leaves out an empty content", () => {
        const data = payDataOf({ link: { ...link, content: "" }, words, terms, status })
        expect(data.facts.some((fact) => fact.id === "content")).toBe(false)
    })
})

describe("refusedPayData", () => {
    it("has no account, no facts and no command", () => {
        expect(refusedPayData("live")).toEqual({ refusal: "live", accountId: null, facts: [], caseId: null, inputs: [] })
    })
})

describe("payTargetOf", () => {
    it("sends through the link's account its first case and its inputs", () => {
        const data = payDataOf({ link, words, terms, status })
        expect(payTargetOf(data)).toEqual({ accountId: "c1", caseId: "PAYOS-3", inputs: [{ name: "orderCode", value: "1780000000001" }] })
    })

    it("has nothing to send while the link is not read, is refused, or is closed (no case)", () => {
        expect(payTargetOf(undefined)).toBeNull()
        expect(payTargetOf(refusedPayData("unknown"))).toBeNull()
        expect(payTargetOf(payDataOf({ link: { ...link, status: "paid", caseIds: [] }, words, terms, status }))).toBeNull()
    })
})
