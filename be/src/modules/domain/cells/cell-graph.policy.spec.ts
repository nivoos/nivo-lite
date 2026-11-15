import type { CellGraphFile, CellRef } from "./cells.contracts"
import { CellsErrorCode } from "./errors/cells.error"
import { CellJsonSchemaPolicy } from "./cell-json-schema.policy"
import { graphProblemOf, nodeRefsOf, type GraphFacts } from "./cell-graph.policy"

const NODE: CellRef = { kind: "node", key: "n", version: 1 }
const facts: GraphFacts = {
    cellOf: (ref) =>
        ref.key === "n" && ref.version === 1
            ? {
                  kind: "node",
                  retired: false,
                  outputSchema: {
                      type: "object",
                      properties: {
                          a: { type: "object", properties: { b: { type: "string" } } },
                          list: { type: "array", items: { type: "string" } },
                      },
                  },
              }
            : ref.key === "old"
              ? { kind: "node", retired: true, outputSchema: {} }
              : null,
    schemaProblemOf: (schema) => new CellJsonSchemaPolicy().schemaProblemOf(schema),
}

const graph = (steps: object, more: object = {}): CellGraphFile =>
    ({ key: "g", version: 1, start: "a", triggers: [{ verb: "v" }], steps, ...more }) as unknown as CellGraphFile

const node = (more: object = {}): object => ({
    kind: "node",
    cell: NODE,
    input: {},
    mode: "auto",
    accounts: [],
    ...more,
})

const present = "present"

const BODY = { body: { start: "p", steps: { p: node() } } }

const codeOf = (document: CellGraphFile): string | undefined => graphProblemOf(document, facts)?.code

describe("graphProblemOf", () => {
    it("accepts a node, a wait with a hand-back, a call, an outcome and an until loop with a wait", () => {
        const steps = {
            a: node({ next: "w" }),
            w: {
                kind: "core.wait",
                config: { keys: [{ verb: "v", match: { x: 1 } }], timeout: { minutes: 5 }, next: "h" },
            },
            h: { kind: "core.hand-back", config: { wait: "w", next: "c" } },
            c: {
                kind: "core.call-workflow",
                config: { graph: "other", version: 2, input: { x: { $ref: "steps.a.output.a.b" } }, next: "l" },
            },
            l: {
                kind: "core.loop",
                config: {
                    until: { op: present, ref: { $ref: "steps.p.output.list.0" } },
                    max: 30,
                    every: { hours: 4 },
                    exhausted: "o",
                    body: {
                        start: "p",
                        steps: {
                            p: node({ next: "pw" }),
                            pw: { kind: "core.wait", config: { keys: [{ verb: "v" }] } },
                        },
                    },
                },
            },
            o: { kind: "core.outcome", config: { name: "done", output: { r: { $ref: "trigger.r" } } } },
        }

        expect(graphProblemOf(graph(steps), facts)).toBeNull()
    })

    it("lists the node refs of a graph, loop bodies included", () => {
        const document = graph({
            a: node(),
            l: {
                kind: "core.loop",
                config: { body: { steps: { p: node({ cell: { kind: "node", key: "m", version: 2 } }) } } },
            },
            bad: { kind: "core.outcome" },
        })

        expect(nodeRefsOf(document)).toEqual([NODE, { kind: "node", key: "m", version: 2 }])
        expect(nodeRefsOf({ ...document, steps: 1 } as unknown as CellGraphFile)).toEqual([])
    })

    it.each([
        ["no steps", graph({}), CellsErrorCode.BodyInvalid],
        ["a start that is not a step", graph({ b: node() }), CellsErrorCode.GraphRouteMissing],
        ["a trigger with no verb", graph({ a: node() }, { triggers: [{}] }), CellsErrorCode.BodyInvalid],
        ["triggers that are not a list", graph({ a: node() }, { triggers: 1 }), CellsErrorCode.BodyInvalid],
        ["a step of no known kind", graph({ a: { kind: "zzz" } }), CellsErrorCode.BodyInvalid],
        [
            "a retired node",
            graph({ a: node({ cell: { kind: "node", key: "old", version: 1 } }) }),
            CellsErrorCode.GraphRefUnknown,
        ],
        [
            "a node of another kind",
            graph({ a: node({ cell: { kind: "tool", key: "n", version: 1 } }) }),
            CellsErrorCode.KindMismatch,
        ],
        ["a node with a bad ref", graph({ a: node({ cell: { key: 1 } }) }), CellsErrorCode.BodyInvalid],
        ["a node with a bad mode", graph({ a: node({ mode: "x" }) }), CellsErrorCode.BodyInvalid],
        ["a node with bad accounts", graph({ a: node({ accounts: [1] }) }), CellsErrorCode.BodyInvalid],
        ["a node with bad input", graph({ a: node({ input: 1 }) }), CellsErrorCode.BodyInvalid],
        ["a node with bad routes", graph({ a: node({ routes: 1 }) }), CellsErrorCode.BodyInvalid],
        ["a node route to nowhere", graph({ a: node({ routes: { x: "q" } }) }), CellsErrorCode.GraphRouteMissing],
        ["a self route", graph({ a: node({ next: "a" }) }), CellsErrorCode.GraphCycle],
        [
            "an if with no yes",
            graph({ a: { kind: "core.if", when: { op: "present", ref: { $ref: "trigger.x" } } } }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "an if with a bad label",
            graph({ a: { kind: "core.if", yes: "a", label: { vi: 1 }, when: {} } }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "an expression that is not an object",
            graph({ a: { kind: "core.if", yes: "b", when: 1 }, b: { kind: "core.outcome", config: { name: "x" } } }),
            CellsErrorCode.ExprInvalid,
        ],
        ["an and with no list", exprGraph({ and: [] }), CellsErrorCode.ExprInvalid],
        [
            "an and with other members",
            exprGraph({ and: [{ op: "present", ref: { $ref: "trigger.x" } }], not: {} }),
            CellsErrorCode.ExprInvalid,
        ],
        [
            "a not with other members",
            exprGraph({ not: { op: "present", ref: { $ref: "trigger.x" } }, op: "x" }),
            CellsErrorCode.ExprInvalid,
        ],
        ["a leaf with no ref", exprGraph({ op: "present" }), CellsErrorCode.ExprInvalid],
        [
            "a present with a value",
            exprGraph({ op: "present", ref: { $ref: "trigger.x" }, value: 1 }),
            CellsErrorCode.ExprInvalid,
        ],
        ["an eq with no value", exprGraph({ op: "eq", ref: { $ref: "trigger.x" } }), CellsErrorCode.ExprInvalid],
        [
            "a caseFold on gt",
            exprGraph({ op: "gt", ref: { $ref: "trigger.x" }, value: 1, caseFold: true }),
            CellsErrorCode.ExprInvalid,
        ],
        [
            "a ref with an extra member",
            exprGraph({ op: "eq", ref: { $ref: "trigger.x" }, value: { $ref: "trigger.y", z: 1 } }),
            CellsErrorCode.ExprInvalid,
        ],
        [
            "a ref with a bad round",
            exprGraph({ op: "eq", ref: { $ref: "trigger.x", round: "next" }, value: 1 }),
            CellsErrorCode.ExprInvalid,
        ],
        [
            "a ref with an empty part",
            exprGraph({ op: "present", ref: { $ref: "trigger..x" } }),
            CellsErrorCode.ExprInvalid,
        ],
        ["a ref to trigger alone", exprGraph({ op: "present", ref: { $ref: "trigger" } }), CellsErrorCode.ExprInvalid],
        ["a ref to vars alone", exprGraph({ op: "present", ref: { $ref: "vars" } }), CellsErrorCode.ExprInvalid],
        ["a ref of an unknown root", exprGraph({ op: "present", ref: { $ref: "zzz.x" } }), CellsErrorCode.ExprInvalid],
        [
            "a steps ref that is not output",
            exprGraph({ op: "present", ref: { $ref: "steps.a.input.x" } }),
            CellsErrorCode.ExprInvalid,
        ],
        ["a set that is empty", graph({ a: { kind: "core.set", config: { set: {} } } }), CellsErrorCode.BodyInvalid],
        [
            "a set of an undeclared name",
            graph({ a: { kind: "core.set", config: { set: { q: 1 } } } }),
            CellsErrorCode.VarUndeclared,
        ],
        ["a wait with no keys", graph({ a: { kind: "core.wait", config: {} } }), CellsErrorCode.BodyInvalid],
        [
            "a wait key with no verb",
            graph({ a: { kind: "core.wait", config: { keys: [{}] } } }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "a wait key with a bad match",
            graph({ a: { kind: "core.wait", config: { keys: [{ verb: "v", match: 1 }] } } }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "a wait with a bad timeout",
            graph({ a: { kind: "core.wait", config: { keys: [{ verb: "v" }], timeout: { weeks: 1 } } } }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "a hand-back of a step that does not wait",
            graph({ a: { kind: "core.hand-back", config: { wait: "a" } } }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "a call with no graph",
            graph({ a: { kind: "core.call-workflow", config: { version: 1 } } }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "a call with a bad version",
            graph({ a: { kind: "core.call-workflow", config: { graph: "x", version: 0 } } }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "a call with bad input",
            graph({ a: { kind: "core.call-workflow", config: { graph: "x", version: 1, input: 1 } } }),
            CellsErrorCode.BodyInvalid,
        ],
        ["an outcome with no name", graph({ a: { kind: "core.outcome", config: {} } }), CellsErrorCode.BodyInvalid],
        [
            "an outcome with bad output",
            graph({ a: { kind: "core.outcome", config: { name: "x", output: 1 } } }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "a loop with both over and until",
            loopGraph({ over: { $ref: "trigger.x" }, until: {} }),
            CellsErrorCode.BodyInvalid,
        ],
        ["a loop with no body", loopGraph({ over: { $ref: "trigger.x" }, body: 1 }), CellsErrorCode.BodyInvalid],
        ["a loop over a literal", loopGraph({ over: 1, ...BODY }), CellsErrorCode.BodyInvalid],
        ["a loop with no key", loopGraph({ over: { $ref: "trigger.x" }, max: 5, ...BODY }), CellsErrorCode.BodyInvalid],
        [
            "a loop with concurrency 6",
            loopGraph({ over: { $ref: "trigger.x" }, key: "k", max: 5, concurrency: 6, ...BODY }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "an until loop with max 11 and no wait",
            loopGraph({ until: { op: "present", ref: { $ref: "trigger.x" } }, max: 11, exhausted: "a", ...BODY }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "an until loop with a bad every",
            loopGraph({
                until: { op: "present", ref: { $ref: "trigger.x" } },
                max: 2,
                every: {},
                exhausted: "a",
                ...BODY,
            }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "an until loop with no exhausted",
            loopGraph({ until: { op: "present", ref: { $ref: "trigger.x" } }, max: 2, ...BODY }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "a body that starts nowhere",
            loopGraph({ over: { $ref: "trigger.x" }, key: "k", max: 5, body: { start: "zz", steps: { p: node() } } }),
            CellsErrorCode.GraphRouteMissing,
        ],
        ["vars that are not an object", graph({ a: node() }, { vars: 1 }), CellsErrorCode.BodyInvalid],
        ["a var with a bad name", graph({ a: node() }, { vars: { Bad: { schema: {} } } }), CellsErrorCode.BodyInvalid],
        [
            "a var with a bad schema",
            graph({ a: node() }, { vars: { x: { schema: { type: "q" } } } }),
            CellsErrorCode.SchemaInvalid,
        ],
        [
            "a var that merges a non-list",
            graph({ a: node() }, { vars: { x: { schema: { type: "number" }, merge: "append" } } }),
            CellsErrorCode.BodyInvalid,
        ],
        [
            "a var with a merge other than append",
            graph({ a: node() }, { vars: { x: { schema: { type: "array" }, merge: "sum" } } }),
            CellsErrorCode.BodyInvalid,
        ],
    ])("refuses %s", (_name, document, code) => {
        expect(codeOf(document)).toBe(code)
    })

    it("allows a ref to a member the output schema lists, a numbered item of a list, a value ref in an order comparison, and item inside a loop", () => {
        const steps = {
            a: node({
                next: "i",
                input: { x: { $ref: "steps.a.output.a.b" }, y: [{ $ref: "steps.a.output.list.0" }], z: { n: 1 } },
            }),
            i: {
                kind: "core.if",
                yes: "a2",
                when: { op: "gte", ref: { $ref: "trigger.at" }, value: "2026-11-15T10:00:00Z" },
            },
            a2: { kind: "core.outcome", config: { name: "x" } },
        }

        expect(graphProblemOf(graph(steps), facts)).toBeNull()
    })

    it("refuses a ref to an output member the node does not list, and one to an unknown step", () => {
        expect(codeOf(graph({ a: node({ input: { x: { $ref: "steps.a.output.zzz" } } }) }))).toBe(
            CellsErrorCode.ExprInvalid,
        )
    })

    it("lets another bug propagate instead of hiding it", () => {
        const broken: GraphFacts = {
            ...facts,
            cellOf: () => {
                throw new TypeError("boom")
            },
        }

        expect(() => graphProblemOf(graph({ a: node() }), broken)).toThrow("boom")
    })
})

/** A graph whose one step is an if over the expression, with a step to go to. */
function exprGraph(when: object): CellGraphFile {
    return graph({ a: { kind: "core.if", yes: "b", when }, b: { kind: "core.outcome", config: { name: "x" } } })
}

/** A graph whose one step is a loop with the config. */
function loopGraph(config: object): CellGraphFile {
    return graph({ a: { kind: "core.loop", config } })
}
