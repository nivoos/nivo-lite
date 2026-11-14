import { schemaProblemOf } from "./cell-schema-shape.policy"

describe("schemaProblemOf", () => {
    it("accepts the schemas the fixtures use, true and false, and keywords it does not know", () => {
        const schema = {
            type: "object",
            required: ["a"],
            properties: { a: { type: ["string", "null"], minLength: 1 }, b: { $ref: "#/$defs/n" }, c: { type: "array", items: { type: "number" }, minItems: 0, maxItems: 3 } },
            $defs: { n: { type: "integer", minimum: 0, multipleOf: 1 } },
            "x-note": 1,
        }

        expect(schemaProblemOf(schema)).toBeNull()
        expect(schemaProblemOf(true)).toBeNull()
        expect(schemaProblemOf({ allOf: [{}, true] })).toBeNull()
    })

    it.each([
        ["a schema that is a string", "x", "$: a schema is an object"],
        ["an unknown type", { type: "strng" }, "$.type"],
        ["a type list with a repeat", { type: ["string", "string"] }, "$.type"],
        ["an empty enum", { enum: [] }, "$.enum"],
        ["required that is not names", { required: [1] }, "$.required"],
        ["required that repeats", { required: ["a", "a"] }, "$.required"],
        ["required outside properties", { properties: {}, required: ["a"] }, "$.required"],
        ["a pattern that is not a regular expression", { pattern: "(" }, "$.pattern"],
        ["a pattern that is not text", { pattern: 1 }, "$.pattern"],
        ["multipleOf 0", { multipleOf: 0 }, "$.multipleOf"],
        ["uniqueItems that is not a flag", { uniqueItems: "yes" }, "$.uniqueItems"],
        ["a negative count", { minLength: -1 }, "$.minLength"],
        ["a text keyword that is a number", { title: 1 }, "$.title"],
        ["a number keyword that is text", { minimum: "1" }, "$.minimum"],
        ["a range that is empty", { minItems: 3, maxItems: 1 }, "minItems is above maxItems"],
        ["items as a list", { items: [{}] }, "$.items"],
        ["an empty allOf", { allOf: [] }, "$.allOf"],
        ["a bad schema inside allOf", { allOf: [{ type: "x" }] }, "$.allOf[0].type"],
        ["properties that is not an object", { properties: 1 }, "$.properties"],
        ["a bad schema inside properties", { properties: { a: { type: 1 } } }, "$.properties.a.type"],
        ["a remote $ref", { $ref: "http://x/y" }, "$.$ref"],
        ["a local $ref that does not resolve", { $ref: "#/$defs/none" }, "$.$ref"],
        ["dependentRequired that is not lists", { dependentRequired: { a: 1 } }, "$.dependentRequired"],
    ])("refuses %s", (_name, schema, expected) => {
        expect(schemaProblemOf(schema)).toContain(expected)
    })

    it("resolves a local reference through a list and an escaped name", () => {
        expect(schemaProblemOf({ $defs: { "a/b": {} }, $ref: "#/$defs/a~1b" })).toBeNull()
        expect(schemaProblemOf({ allOf: [{}], $ref: "#/allOf/0" })).toBeNull()
        expect(schemaProblemOf({ $ref: "#" })).toBeNull()
    })
})
