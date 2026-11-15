import { CellJsonSchemaPolicy } from "./cell-json-schema.policy"
import { CellsErrorCode } from "./errors/cells.error"

const schema = {
    type: "object",
    required: ["orderId", "total"],
    properties: {
        orderId: { type: "string", minLength: 1 },
        total: { type: "number", exclusiveMinimum: 0 },
        lines: { type: "array", prefixItems: [{ type: "string" }], items: { type: "integer" } },
    },
    additionalProperties: false,
} as const

describe("CellJsonSchemaPolicy (JSON Schema 2020-12)", () => {
    const policy = new CellJsonSchemaPolicy()

    it.each<readonly [string, unknown, string | null]>([
        ["a fitting value", { orderId: "DH1", total: 5 }, null],
        ["a missing member is reported at the root", { orderId: "DH1" }, "/"],
        ["a wrong type is reported at its path", { orderId: 5, total: 5 }, "/orderId"],
        ["an exclusive bound", { orderId: "DH1", total: 0 }, "/total"],
        ["an extra member", { orderId: "DH1", total: 5, other: 1 }, "/"],
        ["2020-12 prefixItems and items", { orderId: "DH1", total: 5, lines: ["a", 1, 2] }, null],
        ["2020-12 prefixItems refuses a wrong first item", { orderId: "DH1", total: 5, lines: [1] }, "/lines/0"],
        ["a root of another type", "text", "/"],
    ])("%s", (_label, value, expected) => {
        expect(policy.problemOf("tool:x@1", schema, value as never)).toBe(expected)
    })

    it("reuses a compiled schema whatever the member order of its text", () => {
        const reordered = {
            additionalProperties: false,
            properties: schema.properties,
            required: schema.required,
            type: "object",
        } as const
        expect(policy.problemOf("a", schema, { orderId: "A", total: 1 })).toBeNull()
        expect(policy.problemOf("a", reordered, { orderId: "A", total: 1 })).toBeNull()
    })

    it("keeps a bounded number of compiled schemas and still answers after the oldest goes", () => {
        const small = new CellJsonSchemaPolicy()
        for (let index = 0; index < 501; index += 1)
            expect(small.problemOf("a", { type: "object", maxProperties: index }, {})).toBeNull()
        expect(small.problemOf("a", { type: "object", maxProperties: 0 }, {})).toBeNull()
    })

    it("refuses a schema it cannot compile with CELLS_SCHEMA_INVALID", () => {
        expect(() => policy.problemOf("tool:x@1", { type: "no-such-type" }, 1)).toThrow(
            expect.objectContaining({ code: CellsErrorCode.SchemaInvalid, params: { ref: "tool:x@1", path: "/" } }),
        )
    })

    it("is the one schema check: a 2020-12 document that compiles under the executor's strict settings, else the path and the reason", () => {
        expect(policy.schemaProblemOf({ type: "object", properties: { a: { type: "string" } } })).toBeNull()
        expect(policy.schemaProblemOf(true)).toBeNull()
        expect(policy.schemaProblemOf({ type: 5 })).toMatch(/^\/: schema\/type must be/u)
        expect(policy.schemaProblemOf("object")).toBe("/: a schema is an object or true / false")
        expect(policy.schemaProblemOf([])).toBe("/: a schema is an object or true / false")
        expect(policy.schemaProblemOf(null)).toBe("/: a schema is an object or true / false")
        expect(policy.schemaProblemOf({ type: "object", requird: ["a"] })).toMatch(/^\/: .*requird/u)
    })
})
