import { exprTruth as v1Truth } from "@nivo-lite/agent-sdk/template"
import type { JsonValue, StoredExpr } from "./cells.contracts"
import { CellExpressionPolicy, EXPRESSION_MAX_DEPTH, type ExpressionScope } from "./cell-expression.policy"

type V1Expr = Parameters<typeof v1Truth>[0]
type V1Ref = Parameters<Parameters<typeof v1Truth>[1]>[0]

const policy = new CellExpressionPolicy()
const scopeOf = (over: Partial<ExpressionScope> = {}): ExpressionScope => ({ trigger: {}, steps: {}, vars: {}, item: null, ...over })
const at = (name: string, fallback: JsonValue = null) => ({ $ref: name, default: fallback })

describe("CellExpressionPolicy parity with V1 condition-eval", () => {
    const pool: ReadonlyArray<JsonValue> = [
        null,
        "",
        [],
        [1],
        0,
        1,
        5,
        "5",
        "a",
        "A",
        "ǅ",
        "ſ",
        "İ",
        "ß",
        Number.POSITIVE_INFINITY,
        "i",
        "2026-01-02",
        "2026-01-03T00:00:00Z",
        "2026-01-03",
        true,
        false,
        { a: 1 },
        "HD-1",
    ]
    const OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "contains"] as const

    it("agrees with V1 on every leaf: each operator over every pair of values, with and without caseFold, value as literal and as ref", () => {
        let rows = 0
        for (const left of pool) {
            for (const right of pool) {
                const flat: Record<string, JsonValue> = { "trigger.l": left, "trigger.r": right }
                const read = (ref: V1Ref): JsonValue => flat[ref.$ref] ?? ref.default ?? null
                const scope = scopeOf({ trigger: { l: left, r: right } })
                for (const op of OPS) {
                    for (const caseFold of [false, true]) {
                        for (const viaRef of [false, true]) {
                            const mine: StoredExpr = {
                                op,
                                ref: at("trigger.l"),
                                value: viaRef ? at("trigger.r") : right,
                                ...(caseFold ? { caseFold: true as const } : {}),
                            }
                            expect(policy.truthOf(mine, scope)).toBe(v1Truth(mine as V1Expr, read))
                            rows += 1
                        }
                    }
                }
                for (const op of ["present", "absent"] as const) {
                    const mine: StoredExpr = { op, ref: at("trigger.l") }
                    expect(policy.truthOf(mine, scope)).toBe(v1Truth(mine as V1Expr, read))
                    rows += 1
                }
            }
        }
        expect(rows).toBeGreaterThan(10000)
    })

    it("agrees with V1 on and / or / not over every combination of true, false and unknown", () => {
        const leaves: Record<string, StoredExpr> = {
            t: { op: "eq", ref: at("trigger.n"), value: 1 },
            f: { op: "eq", ref: at("trigger.n"), value: 2 },
            u: { op: "gt", ref: at("trigger.n"), value: "text" },
        }
        const flat: Record<string, JsonValue> = { "trigger.n": 1 }
        const read = (ref: V1Ref): JsonValue => flat[ref.$ref] ?? ref.default ?? null
        const scope = scopeOf({ trigger: { n: 1 } })
        const names = Object.keys(leaves)
        const picked = (name: string): StoredExpr => leaves[name] as StoredExpr
        for (const a of names) {
            expect(policy.truthOf({ not: picked(a) }, scope)).toBe(v1Truth({ not: picked(a) } as V1Expr, read))
            for (const b of names) {
                for (const c of names) {
                    const shapes: ReadonlyArray<StoredExpr> = [
                        { and: [picked(a), picked(b), picked(c)] },
                        { or: [picked(a), picked(b), picked(c)] },
                        { not: { and: [picked(a), { or: [picked(b), picked(c)] }] } },
                    ]
                    for (const shape of shapes) expect(policy.truthOf(shape, scope)).toBe(v1Truth(shape as V1Expr, read))
                }
            }
        }
    })
})

describe("CellExpressionPolicy refs of the run memory", () => {
    const scope = scopeOf({
        trigger: { amount: 5, payer: { name: "An" }, list: ["x", "y"] },
        steps: { pay: { output: { payKey: "DH1", nested: { deep: 7 } } } },
        previous: { pay: { output: { payKey: "DH0" } } },
        vars: { total: { value: { sum: 10 }, by: "sum", at: "2026-11-15T00:00:00.000Z" }, flag: { value: false, by: "x", at: "t" } },
        item: { name: "lead", $round: 2 },
    })

    it.each<readonly [string, { $ref: string; default?: JsonValue; round?: "previous" }, JsonValue]>([
        ["trigger member", { $ref: "trigger.amount" }, 5],
        ["trigger nested", { $ref: "trigger.payer.name" }, "An"],
        ["list index", { $ref: "trigger.list.1" }, "y"],
        ["step output", { $ref: "steps.pay.output.payKey" }, "DH1"],
        ["step output deep", { $ref: "steps.pay.output.nested.deep" }, 7],
        ["step output whole", { $ref: "steps.pay.output" }, { payKey: "DH1", nested: { deep: 7 } }],
        ["previous round", { $ref: "steps.pay.output.payKey", round: "previous" }, "DH0"],
        ["a variable", { $ref: "vars.total" }, { sum: 10 }],
        ["inside a variable", { $ref: "vars.total.sum" }, 10],
        ["a false variable is a value, not absent", { $ref: "vars.flag", default: "d" }, false],
        ["item", { $ref: "item.name" }, "lead"],
        ["item round", { $ref: "item.$round" }, 2],
        ["absent takes the default", { $ref: "trigger.missing", default: "d" }, "d"],
        ["absent with no default is null", { $ref: "trigger.missing" }, null],
        ["undeclared variable takes the default", { $ref: "vars.none", default: 0 }, 0],
        ["a step path without the output word is absent", { $ref: "steps.pay.payKey", default: "n" }, "n"],
        ["unknown step takes the default", { $ref: "steps.none.output.x", default: 1 }, 1],
        ["unknown region takes the default", { $ref: "elsewhere.x", default: "e" }, "e"],
        ["a path through a text is absent", { $ref: "trigger.payer.name.first", default: "n" }, "n"],
        ["a path through a list index out of range is absent", { $ref: "trigger.list.9", default: "n" }, "n"],
        ["a path through a list with a bad index is absent", { $ref: "trigger.list.x", default: "n" }, "n"],
    ])("%s", (_label, ref, expected) => {
        expect(policy.resolveRef(ref, scope)).toEqual(expected)
    })

    it("reads no previous round when the scope has none", () => {
        expect(policy.resolveRef({ $ref: "steps.pay.output.payKey", round: "previous", default: "none" }, scopeOf())).toBe("none")
    })

    it("reads a variable in a condition", () => {
        expect(policy.holds({ op: "gt", ref: { $ref: "vars.total.sum" }, value: 5 }, scope)).toBe(true)
        expect(policy.holds({ op: "eq", ref: { $ref: "vars.flag" }, value: false }, scope)).toBe(true)
    })
})

describe("CellExpressionPolicy conditions", () => {
    const scope = scopeOf({ trigger: { text: "Hello" } })

    it("unknown is not true, takes the no branch, and not keeps it unknown", () => {
        const mismatch: StoredExpr = { op: "gt", ref: at("trigger.text"), value: 3 }
        expect(policy.truthOf(mismatch, scope)).toBe("unknown")
        expect(policy.holds(mismatch, scope)).toBe(false)
        expect(policy.truthOf({ not: mismatch }, scope)).toBe("unknown")
        expect(policy.decide({ when: mismatch, yes: "a", no: "b" }, scope)).toEqual({ truth: "unknown", branch: "no", next: "b" })
        expect(policy.decide({ when: mismatch, yes: "a" }, scope)).toEqual({ truth: "unknown", branch: "no", next: null })
    })

    it("takes the yes branch on true and the no branch on false", () => {
        const holds: StoredExpr = { op: "contains", ref: at("trigger.text"), value: "ell" }
        expect(policy.decide({ when: holds, yes: "a", no: "b" }, scope)).toEqual({ truth: true, branch: "yes", next: "a" })
        expect(policy.decide({ when: { not: holds }, yes: "a", no: "b" }, scope)).toEqual({ truth: false, branch: "no", next: "b" })
    })

    it("bounds the depth: an expression deeper than the bound is unknown and a save problem", () => {
        const leaf: StoredExpr = { op: "present", ref: at("trigger.text") }
        let deep: StoredExpr = leaf
        for (let level = 0; level < EXPRESSION_MAX_DEPTH + 1; level += 1) deep = { not: deep }
        expect(policy.depthOf(deep)).toBe(EXPRESSION_MAX_DEPTH + 1)
        expect(policy.truthOf(deep, scope)).toBe("unknown")
        expect(policy.problemsOf(deep)).toEqual(["depth"])
        expect(policy.problemsOf({ not: leaf })).toEqual([])
        expect(policy.problemsOf({ op: "bogus" })).toEqual(["shape"])
        expect(policy.depthOf({ and: [] })).toBe(1)
        expect(policy.depthOf({ or: [leaf, { not: leaf }] })).toBe(2)
    })

    it("bounds a literal: an integer inside the limits, else null", () => {
        expect(policy.boundOf(50, { min: 1, max: 50 })).toBe(50)
        expect(policy.boundOf(51, { min: 1, max: 50 })).toBeNull()
        expect(policy.boundOf(0, { min: 1, max: 50 })).toBeNull()
        expect(policy.boundOf(2.5, { min: 1, max: 50 })).toBeNull()
        expect(policy.boundOf("3", { min: 1, max: 50 })).toBeNull()
    })
})

describe("CellExpressionPolicy mappings and core.set", () => {
    const scope = scopeOf({
        trigger: { amount: 350000, order: "DH1001" },
        steps: { pay: { output: { payKey: "DH1001" } } },
        vars: { count: { value: 2, by: "earlier", at: "t0" } },
    })

    it("resolves the input mapping of a step: refs, defaults, literals, nested members and lists", () => {
        expect(
            policy.mapInput(
                {
                    orderId: at("trigger.order"),
                    total: { $ref: "trigger.amount" },
                    key: { $ref: "steps.pay.output.payKey" },
                    note: "fixed",
                    missing: { $ref: "trigger.none", default: "d" },
                    nested: { a: { $ref: "vars.count" }, list: [{ $ref: "trigger.order" }, 3] },
                },
                scope,
            ),
        ).toEqual({
            orderId: "DH1001",
            total: 350000,
            key: "DH1001",
            note: "fixed",
            missing: "d",
            nested: { a: 2, list: ["DH1001", 3] },
        })
    })

    it("computes the variables update { value, by, at } from refs, literals and expressions, against the state before the step", () => {
        const update = policy.setVariables(
            {
                set: {
                    paid: { op: "gte", ref: at("trigger.amount"), value: 300000 },
                    payKey: { $ref: "steps.pay.output.payKey" },
                    count: { $ref: "vars.count" },
                    label: "vip",
                    unsure: { op: "gt", ref: at("trigger.order"), value: 1 },
                    either: { or: [{ op: "present", ref: at("trigger.none") }, { op: "absent", ref: at("trigger.none") }] },
                },
            },
            scope,
            "setter",
            "2026-11-15T01:00:00.000Z",
        )
        const stamp = { by: "setter", at: "2026-11-15T01:00:00.000Z" }
        expect(update).toEqual({
            paid: { value: true, ...stamp },
            payKey: { value: "DH1001", ...stamp },
            count: { value: 2, ...stamp },
            label: { value: "vip", ...stamp },
            unsure: { value: null, ...stamp },
            either: { value: true, ...stamp },
        })
    })
})
