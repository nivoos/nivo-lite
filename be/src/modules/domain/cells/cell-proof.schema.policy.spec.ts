import { sampleOf, violationsOf } from "./cell-proof.schema.policy"

describe("sampleOf", () => {
    it("builds the required members of an object, each by its own schema", () => {
        expect(
            sampleOf({
                type: "object",
                required: ["id", "total", "ok", "tags", "none", "free"],
                properties: {
                    id: { type: "string", minLength: 3 },
                    total: { type: "integer", minimum: 5 },
                    ok: { type: "boolean" },
                    tags: { type: "array", minItems: 2, items: { type: "string" } },
                    none: { type: "null" },
                    free: {},
                    unlisted: { type: "string" },
                },
            }),
        ).toEqual({ id: "xxx", total: 5, ok: true, tags: ["x", "x"], none: null, free: {} })
    })

    it("takes a constant, the first enum member, the first alternative, and respects the bounds of a number", () => {
        expect(sampleOf({ const: "fixed" })).toBe("fixed")
        expect(sampleOf({ enum: ["a", "b"] })).toBe("a")
        expect(sampleOf({ oneOf: [{ type: "boolean" }, { type: "string" }] })).toBe(true)
        expect(sampleOf({ anyOf: [{ type: "string" }] })).toBe("x")
        expect(sampleOf({ type: "number", exclusiveMinimum: 10 })).toBe(11)
        expect(sampleOf({ type: "number", maximum: 0 })).toBe(0)
        expect(sampleOf({ type: ["string", "null"] })).toBe("x")
        expect(sampleOf({ properties: { a: { type: "string" } } })).toEqual({})
        expect(sampleOf({ type: "array", items: true })).toEqual([])
        expect(sampleOf({ type: "object", required: ["a"] })).toEqual({ a: null })
        expect(sampleOf({})).toEqual({})
    })
})

describe("violationsOf", () => {
    it("breaks the type, a missing required member and a wrong member, each once", () => {
        expect(
            violationsOf({ type: "object", required: ["id", "n"], properties: { id: { type: "string" }, n: { type: "number" } } }),
        ).toEqual(["kit-invalid", { n: 1 }, { id: false, n: 1 }])
    })

    it("breaks an enum and a const, and answers nothing for a schema that cannot be broken", () => {
        expect(violationsOf({ enum: ["a"] })).toEqual(["kit-outside-enum"])
        expect(violationsOf({ const: 1 })).toEqual([{ kit: "outside-const" }])
        expect(violationsOf({})).toEqual([])
        expect(violationsOf({ type: ["string", "boolean", "array", "object", "null"] })).toEqual([])
        expect(violationsOf({ type: "string" })).toEqual([false])
    })
})
