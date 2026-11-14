import type { GraphSpec, GraphSpecNode } from "@nivo-lite/agent-sdk/graph"
import { AgentGraphsErrorCode } from "../errors/agent-graphs.error"
import {
    candidatesOf,
    graphWithNodeSettings,
    judgedAccountChoice,
    nodeSettingsViewsOf,
    settableOf,
    settingsOf,
    unsettableRefusal,
    withSettingsCleared,
    type AccountCandidate,
} from "./node-settings.policy"

// NODE SETTINGS (rule, engine words): a stored graph is exactly an installed template version except for the closed set of members a
// shop sets on a node step: its mode and the accounts it uses, in try order. One list drives the copy check, the door and the read.

const REPLY: GraphSpecNode = {
    key: "reply",
    kind: "execute",
    step: "desk.answer",
    mode: "auto",
    accounts: [
        { kind: "messaging", provider: "zalo_oa", connectionId: null },
        { kind: "messaging", provider: "telegram", connectionId: null },
    ],
    next: "hand",
}
const PAY: GraphSpecNode = {
    key: "pay",
    kind: "execute",
    step: "sales.request-qr",
    mode: "auto",
    accounts: [{ kind: "payment", provider: "sepay", connectionId: null }],
    next: "hand",
}
const HAND: GraphSpecNode = { key: "hand", kind: "execute", step: "core.call-workflow", next: "end" }
const END: GraphSpecNode = { key: "end", kind: "output", step: "stop" }

const TEMPLATE: GraphSpec = {
    schema: "nivo/agent-graph@1",
    moduleKey: "desk",
    trigger: { kind: "tag", sources: ["agent"] },
    grant: { tools: [], effects: [] },
    nodes: [REPLY, PAY, HAND, END],
}

const unsettable = (key: string): Error => unsettableRefusal(key === "mode" ? "mode" : "accounts")

const ATTACHED: ReadonlyArray<AccountCandidate> = [
    { connectionId: "z1", provider: "zalo_oa", connected: true, sandbox: false },
    { connectionId: "z2", provider: "zalo_oa", connected: true, sandbox: false },
    { connectionId: "b1", provider: "sepay", connected: true, sandbox: false },
    { connectionId: "b2", provider: "sepay", connected: true, sandbox: false },
    { connectionId: "zs", provider: "zalo_oa", connected: true, sandbox: true },
    { connectionId: "zd", provider: "zalo_oa", connected: false, sandbox: false },
]

describe("node-settings.policy: the closed list of what a shop sets on a node step", () => {
    it("a node step takes its mode and (when it lists a provider) its accounts; the trigger, a control step and an outcome take nothing", () => {
        expect(settableOf(REPLY)).toEqual(["mode", "accounts"])
        expect(settableOf({ ...REPLY, accounts: [] })).toEqual(["mode"])
        expect(settableOf(HAND)).toEqual([])
        expect(settableOf(END)).toEqual([])
    })

    it("binds a choice as one entry per chosen account under the template's entry, in try order; the other providers stay unbound", () => {
        const chosen = graphWithNodeSettings(
            TEMPLATE,
            "reply",
            { accounts: [{ provider: "zalo_oa", connectionId: "z2" }, { provider: "zalo_oa", connectionId: "z1" }] },
            unsettable,
        )

        expect(chosen?.nodes[0]?.accounts).toEqual([
            { kind: "messaging", provider: "zalo_oa", connectionId: "z2" },
            { kind: "messaging", provider: "zalo_oa", connectionId: "z1" },
            { kind: "messaging", provider: "telegram", connectionId: null },
        ])
        expect(settingsOf(chosen?.nodes[0] ?? REPLY)).toEqual({ mode: "auto", accounts: ["z2", "z1"] })
        expect(chosen?.nodes.slice(1)).toEqual(TEMPLATE.nodes.slice(1))
    })

    it("an empty choice folds the step back to the template's entries; settings already in force change nothing (null)", () => {
        const chosen = graphWithNodeSettings(TEMPLATE, "pay", { accounts: [{ provider: "sepay", connectionId: "b2" }] }, unsettable)
        if (chosen === null) throw new Error("no change")

        expect(graphWithNodeSettings(chosen, "pay", { accounts: [] }, unsettable)).toEqual(TEMPLATE)
        expect(graphWithNodeSettings(TEMPLATE, "pay", { mode: "auto", accounts: [] }, unsettable)).toBeNull()
    })

    it("refuses, typed, a key no step has and a setting a step does not take", () => {
        expect(() => graphWithNodeSettings(TEMPLATE, "gone", { mode: "ask" }, unsettable)).toThrow(
            expect.objectContaining({ code: AgentGraphsErrorCode.WorkflowRefused, params: { reason: "node" } }),
        )
        expect(() => graphWithNodeSettings(TEMPLATE, "hand", { mode: "ask" }, unsettable)).toThrow(
            expect.objectContaining({ code: AgentGraphsErrorCode.NodeSettingUnsettable, params: { setting: "mode" } }),
        )
        expect(() => graphWithNodeSettings(TEMPLATE, "hand", { accounts: [] }, unsettable)).toThrow(
            expect.objectContaining({ code: AgentGraphsErrorCode.NodeSettingUnsettable, params: { setting: "accounts" } }),
        )
    })

    it("the copy check clears exactly the settings: a copy with modes and accounts set equals the template; any other change does not", () => {
        const set = graphWithNodeSettings(
            graphWithNodeSettings(TEMPLATE, "reply", { mode: "ask", accounts: [{ provider: "zalo_oa", connectionId: "z1" }] }, unsettable) ??
                TEMPLATE,
            "pay",
            { accounts: [{ provider: "sepay", connectionId: "b1" }, { provider: "sepay", connectionId: "b2" }] },
            unsettable,
        )
        if (set === null) throw new Error("no change")
        const cleared = (graph: GraphSpec): string => JSON.stringify(withSettingsCleared(TEMPLATE, graph))

        expect(cleared(set)).toBe(cleared(TEMPLATE))
        // An edit is still an edit: a param, a provider the template does not list, an entry's kind, a mode on a control step.
        const edits: ReadonlyArray<GraphSpec> = [
            { ...set, nodes: set.nodes.map((node) => (node.key === "pay" ? { ...node, params: { amount: 1 } } : node)) },
            {
                ...set,
                nodes: set.nodes.map((node) =>
                    node.key === "pay" ? { ...node, accounts: [{ kind: "payment", provider: "payos", connectionId: "p1" }] } : node,
                ),
            },
            {
                ...set,
                nodes: set.nodes.map((node) =>
                    node.key === "reply" ? { ...node, accounts: [{ kind: "chat", provider: "zalo_oa", connectionId: "z1" }] } : node,
                ),
            },
            { ...set, nodes: set.nodes.map((node) => (node.key === "hand" ? { ...node, mode: "ask" as const } : node)) },
        ]
        for (const edit of edits) expect(cleared(edit)).not.toBe(cleared(TEMPLATE))
    })

    it("judges a choice by rule, never by trust: attached, of a provider the step lists, working, sandbox only when on, once", () => {
        expect(judgedAccountChoice(PAY, ["b2", "b1"], ATTACHED, false)).toEqual([
            { provider: "sepay", connectionId: "b2" },
            { provider: "sepay", connectionId: "b1" },
        ])
        expect(judgedAccountChoice(PAY, [], ATTACHED, false)).toEqual([])
        const codeOf = (wanted: ReadonlyArray<string>, sandboxOn = false): unknown => {
            try {
                judgedAccountChoice(REPLY, wanted, ATTACHED, sandboxOn)
                return null
            } catch (cause) {
                return (cause as { readonly code?: unknown }).code
            }
        }
        expect(codeOf(["x9"])).toBe(AgentGraphsErrorCode.NodeAccountNotAttached)
        expect(codeOf(["b1"])).toBe(AgentGraphsErrorCode.NodeAccountNotListed)
        expect(codeOf(["zd"])).toBe(AgentGraphsErrorCode.NodeAccountNotConnected)
        expect(codeOf(["zs"])).toBe(AgentGraphsErrorCode.NodeAccountSandboxOff)
        expect(codeOf(["zs"], true)).toBeNull()
        expect(codeOf(["z1", "z1"])).toBe(AgentGraphsErrorCode.NodeAccountRepeated)
    })

    it("the read: per step what is settable, what is in force, and the agent's accounts of a provider the step lists", () => {
        const options = ATTACHED.map((account) => ({ ...account, label: account.connectionId, isDefault: account.connectionId === "b1" }))

        expect(candidatesOf(PAY, options).map((option) => option.connectionId)).toEqual(["b1", "b2"])
        expect(nodeSettingsViewsOf(TEMPLATE, options).map((view) => [view.nodeKey, view.settable, view.accounts.length])).toEqual([
            ["reply", ["mode", "accounts"], 4],
            ["pay", ["mode", "accounts"], 2],
            ["hand", [], 0],
            ["end", [], 0],
        ])
    })
})
