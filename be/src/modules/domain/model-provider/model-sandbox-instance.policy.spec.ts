import { z } from "zod"
import { instanceOfSchema } from "./model-sandbox-instance.policy"

describe("instanceOfSchema: the smallest value a schema allows, by structure alone", () => {
    it("an object takes its REQUIRED members only, each the instance of its own schema", () => {
        const schema = {
            type: "object",
            properties: { reply: { type: "string" }, intent: { enum: ["buy", "ask"] }, count: { type: "integer", minimum: 3 }, note: { type: "string" } },
            required: ["reply", "intent", "count"],
        }

        expect(instanceOfSchema(schema)).toEqual({ reply: "", intent: "buy", count: 3 })
    })

    it("an array is empty unless minItems asks for items; a nullable type gives its first non-null type", () => {
        expect(instanceOfSchema({ type: "array", items: { type: "string" } })).toEqual([])
        expect(instanceOfSchema({ type: "array", items: { type: "boolean" }, minItems: 2 })).toEqual([false, false])
        expect(instanceOfSchema({ type: ["null", "string"], minLength: 2 })).toBe("xx")
    })

    it("const and enum win; anyOf takes its first branch; a local $ref is followed; a recursive schema ends at the depth guard", () => {
        expect(instanceOfSchema({ const: "fixed" })).toBe("fixed")
        expect(instanceOfSchema({ anyOf: [{ type: "number" }, { type: "string" }] })).toBe(0)
        const referring = {
            type: "object",
            properties: { who: { $ref: "#/$defs/person" } },
            required: ["who"],
            $defs: { person: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
        }
        expect(instanceOfSchema(referring)).toEqual({ who: { name: "" } })
        const loop: Record<string, unknown> = { type: "object", required: ["next"], properties: {} }
        ;(loop.properties as Record<string, unknown>).next = loop
        expect(() => JSON.stringify(instanceOfSchema(loop))).not.toThrow()
    })

    it("a format gives its fixed value; a bound that excludes zero is respected", () => {
        expect(instanceOfSchema({ type: "string", format: "date-time" })).toBe("2026-01-01T00:00:00.000Z")
        expect(instanceOfSchema({ type: "integer", exclusiveMinimum: 5 })).toBe(6)
        expect(instanceOfSchema({ type: "number", minimum: -2, maximum: -1 })).toBe(-1)
    })

    it("is deterministic and pure: the same schema gives the same value, and the schema is not changed", () => {
        const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] }
        const before = JSON.stringify(schema)

        expect(instanceOfSchema(schema)).toEqual(instanceOfSchema(schema))
        expect(JSON.stringify(schema)).toBe(before)
    })

    it("fits the zod schemas it is made from (the value passes the schema's own parse)", () => {
        const schemas = [
            z.object({ reply: z.string(), confident: z.boolean(), tags: z.array(z.string()) }),
            z.object({ kind: z.enum(["a", "b"]), amount: z.number().int().min(10), when: z.string().datetime() }),
            z.object({ inner: z.object({ id: z.string().min(3), items: z.array(z.object({ n: z.number() })).min(1) }) }),
            z.object({ maybe: z.string().nullable(), union: z.union([z.literal("x"), z.literal("y")]) }),
        ]
        for (const schema of schemas) {
            const made = instanceOfSchema(z.toJSONSchema(schema))
            expect(schema.safeParse(made).success).toBe(true)
        }
    })

    it("does not read meaning: a member NAMED like a business word is still just its type", () => {
        const schema = { type: "object", properties: { price: { type: "string" }, quantity: { type: "number" } }, required: ["price", "quantity"] }

        expect(instanceOfSchema(schema)).toEqual({ price: "", quantity: 0 })
    })
})
