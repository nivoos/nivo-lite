import { bodyProblemOf } from "./cell-body-shape.policy"

describe("bodyProblemOf", () => {
    it("accepts a body of each kind with its required members", () => {
        expect(bodyProblemOf("operation", { provider: "p", method: "POST", path: "/x", replayKeyHeader: "K" })).toBeNull()
        expect(bodyProblemOf("tool", { account: "owner", servedBy: { p: "op" } })).toBeNull()
        expect(bodyProblemOf("tool", { account: "any", servedBy: "primitive:x.y", owners: ["p"] })).toBeNull()
        expect(bodyProblemOf("node", { mode: "ask", accounts: ["a"], blocking: true })).toBeNull()
        expect(bodyProblemOf("trigger", { via: "webhook", withoutPoll: true })).toBeNull()
        expect(bodyProblemOf("provider", { roles: ["r"], auth: {}, baseUrl: "https://x", accountOwner: "platform" })).toBeNull()
        expect(bodyProblemOf("core.if", {})).toBeNull()
    })

    it.each([
        ["operation", {}, "body.provider: required"],
        ["operation", { provider: "p", method: "GET", path: "/" , stray: 1 }, "body.stray"],
        ["operation", { provider: "p", method: "FETCH", path: "/" }, "body.method"],
        ["tool", { account: "owner" }, "body.servedBy: required"],
        ["tool", { account: "owner", servedBy: "nope" }, "body.servedBy"],
        ["tool", { account: "owner", servedBy: {} }, "body.servedBy"],
        ["tool", { account: "owner", servedBy: { p: 1 } }, "body.servedBy"],
        ["tool", { account: "owner", servedBy: 1 }, "body.servedBy"],
        ["node", { mode: "maybe" }, "body.mode"],
        ["node", { accounts: "a" }, "body.accounts"],
        ["node", { blocking: "yes" }, "body.blocking"],
        ["node", { facts: [] }, "body.facts"],
        ["node", { model: "" }, "body.model"],
        ["core.set", { a: 1 }, "body.a"],
    ] as const)("refuses a %s body %j", (kind, body, expected) => {
        expect(bodyProblemOf(kind, body as never)).toContain(expected)
    })
})
