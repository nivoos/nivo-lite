import type { WorkflowTemplate } from "@nivo-lite/agent-sdk/template"
import { readinessOf, readyLineOf, type ReadinessInstalled, type SealedNames } from "./seed-readiness.policy"
import { SET_SEED_SCHEMA } from "./set-seed.contracts"
import { readSeedDocument } from "./set-seed.policy"

/** A template as the installation declares it: its node steps' providers (the template's `requires`) are what COMPLETE reads. */
const template = (id: string, requires: ReadonlyArray<string>, nodes: ReadonlyArray<{ key: string; providers: ReadonlyArray<string> }>): WorkflowTemplate =>
    ({
        id,
        moduleKey: id.split(".")[0],
        primary: id.endsWith(".front"),
        requires: requires.map((kind) => ({ kind, label: { vi: kind, en: kind }, why: { vi: "", en: "" } })),
        versions: [{ version: 1, graph: { nodes: nodes.map((node) => ({ key: node.key, accounts: node.providers.map((provider) => ({ kind: "messaging", provider, connectionId: null })) })) } }],
    }) as unknown as WorkflowTemplate

const INSTALLED: ReadinessInstalled = {
    plugins: [{ key: "shop", visibility: "public", enterprises: [], modules: ["desk"], version: "0.1.0" }],
    templatesOf: (module) =>
        module === "desk"
            ? [template("desk.front", [], [{ key: "answer", providers: ["zalo_oa"] }, { key: "pay", providers: ["sepay", "casso"] }]), template("desk.pay", [], [{ key: "note", providers: ["crm.acme"] }])]
            : [],
    inboundChannelsOf: (module) => new Set(module === "desk" ? ["zalo_oa"] : []),
}

const seed = (overrides: Record<string, unknown> = {}) =>
    readSeedDocument(
        JSON.stringify({
            schema: SET_SEED_SCHEMA,
            use: "workspace",
            name: "x-seed-standard",
            target: "local",
            workspaceName: "X",
            ownerWorkspace: "NIVO",
            plugins: [{ key: "shop", version: "0.1.0" }],
            agents: [{ module: "desk", template: "desk.front", version: 1 }],
            accounts: [
                { key: "zalo", provider: "zalo_oa", name: "Zalo", sandbox: false, secrets: ["credential"] },
                { key: "bank-sbx", provider: "sepay", name: "Sandbox bank" },
                { key: "crm", provider: "openapi", name: "CRM", sandbox: false, secrets: ["credential"], facts: { summary: "acme" } },
            ],
            truths: [{ subject: "X", attribute: "Giờ mở cửa", value: "8-17" }],
            ...overrides,
        }),
        { name: "x-seed-standard", commit: "0".repeat(40) },
    )

const ALL_SET: SealedNames = { zalo: { credential: "set" }, crm: { credential: "set" } }

describe("readinessOf: attachments (R109 finding 2)", () => {
    it("names a sandbox account of a kind no agent accepts, and a node setting naming an account not usable in the place", () => {
        const missing = readinessOf(
            seed({
                accounts: [
                    { key: "zalo", provider: "zalo_oa", name: "Zalo", sandbox: false, secrets: ["credential"] },
                    { key: "bank-sbx", provider: "sepay", name: "Sandbox bank" },
                    { key: "crm", provider: "openapi", name: "CRM", sandbox: false, secrets: ["credential"], facts: { summary: "acme" } },
                    { key: "tele-sbx", provider: "telegram", name: "Sandbox Telegram" },
                    { key: "zalo-sbx", provider: "zalo_oa", name: "Sandbox Zalo" },
                ],
                nodeSettings: [{ module: "desk", workflow: "desk.front", node: "answer", accounts: ["zalo-sbx"] }],
            }),
            INSTALLED,
            ALL_SET,
            "prod",
        )
        expect(missing).toContain("sandbox account tele-sbx: no agent of the standard accepts telegram (it would be attached to none)")
        expect(missing).toContain("node setting desk.front/answer: account zalo-sbx is not usable here (it would not be attached to desk)")
    })
})

describe("readinessOf: COMPLETE, derived from what the installed templates declare", () => {
    it("is READY when every required provider has a usable account (a CRM key is an OpenAPI account of that CRM), an entrance, knowledge, the plugin", () => {
        expect(readinessOf(seed(), INSTALLED, ALL_SET, "local")).toEqual([])
        expect(readyLineOf("x", [])).toBe("x: READY: yes")
    })

    it("names what is missing: an empty credential makes its account unusable; production never counts a sandbox account", () => {
        const missing = readinessOf(seed(), INSTALLED, { zalo: { credential: "empty" }, crm: { credential: "set" } }, "local")
        expect(missing).toEqual([
            "agent desk: no usable account of [zalo_oa] (needed by desk.front/answer)",
            "agent desk: front door of [zalo_oa] but no usable entrance account",
        ])
        expect(readinessOf(seed(), INSTALLED, ALL_SET, "prod")).toEqual(["agent desk: no usable account of [casso | sepay] (needed by desk.front/pay)"])
    })

    it("names a plugin at another version, a template that is not the primary, a missing secret member, no knowledge, a node setting on a foreign provider", () => {
        const missing = readinessOf(
            seed({
                plugins: [{ key: "shop", version: "0.2.0" }],
                agents: [{ module: "desk", template: "desk.pay", version: 1 }],
                truths: [],
                nodeSettings: [{ module: "desk", workflow: "desk.front", node: "answer", accounts: ["bank-sbx"] }],
            }),
            INSTALLED,
            { zalo: { credential: "set" } },
            "local",
        )
        expect(missing).toEqual([
            "plugin shop: installed 0.1.0, seed names 0.2.0",
            "account crm: secret member credential absent from the sealed file",
            "agent desk: template desk.pay is not its installed primary template",
            "agent desk: no usable account of [crm.acme] (needed by desk.pay/note)",
            "node setting desk.front/answer: account bank-sbx is of no provider the node lists [zalo_oa]",
            "knowledge: no document and no truth for the agents to answer from",
        ])
    })
})
