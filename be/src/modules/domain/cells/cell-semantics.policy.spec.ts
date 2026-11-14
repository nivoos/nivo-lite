import { semanticsProblemOf, toolKeysOf, type SemanticsFacts } from "./cell-semantics.policy"

const facts: SemanticsFacts = {
    toolOf: (key) => (key === "write" ? { mutates: true } : key === "read" ? { mutates: false } : null),
    inputMembers: ["ref"],
}

const confirm = { tool: "read", args: { id: { from: "args", member: "ref" } }, happened: { member: "found", equals: true } }

describe("semanticsProblemOf", () => {
    it("accepts a read, a write with a confirmation, a node with tools and a metered read", () => {
        expect(semanticsProblemOf("tool", { mutates: false }, facts)).toBeNull()
        expect(semanticsProblemOf("tool", { mutates: true, outside: true, repeatable: false, refusals: ["a", "b"], finalRefusals: ["a"], onceBy: ["ref"], confirmBy: confirm }, facts)).toBeNull()
        expect(semanticsProblemOf("tool", { mutates: true, confirmBy: { ...confirm, before: confirm } }, facts)).toBeNull()
        expect(semanticsProblemOf("node", { mutates: false, tools: ["read", "write"], readsHeldEvents: true, timeoutMs: 600000 }, facts)).toBeNull()
        expect(semanticsProblemOf("tool", { mutates: false, metered: { usage: "units", price: { usdPerUnit: 0.1 } } }, facts)).toBeNull()
    })

    it.each([
        ["semantics that is not an object", 1, "semantics_must_be_an_object"],
        ["an unknown member", { mutates: false, zzz: 1 }, "unknown_member:zzz"],
        ["mutates missing", {}, "mutates_must_be_boolean"],
        ["outside that is text", { mutates: true, outside: "x" }, "outside_must_be_boolean"],
        ["readsHeldEvents false", { mutates: false, readsHeldEvents: false }, "readsHeldEvents_must_be_true"],
        ["refusals that are not names", { mutates: false, refusals: [1] }, "refusals_must_be_names"],
        ["a timeout above the cap", { mutates: false, timeoutMs: 600001 }, "timeoutMs_must_be"],
        ["a metered with no price", { mutates: false, metered: { usage: "tokens" } }, "metered_must_name"],
        ["a metered with a price of zero", { mutates: false, metered: { usage: "tokens", price: { usdPerUnit: 0 } } }, "metered_must_name"],
        ["finals on a read", { mutates: false, finalRefusals: ["a"], refusals: ["a"] }, "finalRefusals_on_a_read"],
        ["outside on a read", { mutates: false, outside: true }, "outside_on_a_read"],
        ["onceBy on a read", { mutates: false, onceBy: ["ref"] }, "onceBy_on_a_read"],
        ["finals not in refusals", { mutates: true, refusals: ["a"], finalRefusals: ["b"] }, "finalRefusals_not_in_refusals:b"],
        ["onceBy outside the input", { mutates: true, onceBy: ["nope"] }, "onceBy_not_in_input:nope"],
        ["confirmBy on a read", { mutates: false, confirmBy: confirm }, "confirmBy_on_a_read"],
        ["a confirmation read that is a write", { mutates: true, confirmBy: { ...confirm, tool: "write" } }, "confirmBy_tool_is_not_a_read:write"],
        ["a confirmation read that does not exist", { mutates: true, confirmBy: { ...confirm, tool: "zzz" } }, "confirmBy_tool_unknown:zzz"],
        ["a before read that is a write", { mutates: true, confirmBy: { ...confirm, before: { ...confirm, tool: "write" } } }, "confirmBy_before_tool_is_not_a_read:write"],
        ["an argument with no source", { mutates: true, confirmBy: { ...confirm, args: { id: { from: "args" } } } }, "confirmBy_argument_has_no_source"],
        ["a literal argument with no value", { mutates: true, confirmBy: { ...confirm, args: { id: { from: "value" } } } }, "confirmBy_argument_has_no_source"],
        ["a confirmBy with no tool", { mutates: true, confirmBy: { args: {}, happened: { member: "a", equals: 1 } } }, "confirmBy_malformed"],
        ["a happened that is malformed", { mutates: true, confirmBy: { ...confirm, happened: { member: "a", equals: {} } } }, "confirmBy_happened_malformed"],
        ["a node tool that is no tool cell", { mutates: false, tools: ["zzz"] }, "tool_unknown:zzz"],
    ])("refuses %s", (_name, semantics, reason) => {
        expect(semanticsProblemOf("node", semantics, facts)).toContain(reason)
    })

    it("refuses held events and tools outside a node, and a control cell that writes or meters", () => {
        expect(semanticsProblemOf("tool", { mutates: false, readsHeldEvents: true }, facts)).toBe("readsHeldEvents_outside_a_node")
        expect(semanticsProblemOf("tool", { mutates: false, tools: ["read"] }, facts)).toBe("tools_outside_a_node")
        expect(semanticsProblemOf("core.if", { mutates: true }, facts)).toBe("a_control_cell_does_not_write_or_meter")
        expect(semanticsProblemOf("core.set", { mutates: false, metered: { usage: "units", price: "reported" } }, facts)).toBe("a_control_cell_does_not_write_or_meter")
    })

    it("does not check onceBy against an input that names no members", () => {
        expect(semanticsProblemOf("tool", { mutates: true, onceBy: ["x"] }, { ...facts, inputMembers: null })).toBeNull()
    })
})

describe("toolKeysOf", () => {
    it("lists node tools and confirmation reads, and nothing for a malformed value", () => {
        expect(toolKeysOf({ mutates: true, tools: ["a"], confirmBy: { ...confirm, before: { ...confirm, tool: "b" } } })).toEqual(["a", "read", "b"])
        expect(toolKeysOf(1)).toEqual([])
        expect(toolKeysOf({ tools: "a", confirmBy: 1 })).toEqual([])
    })
})
