import { CellsError, CellsErrorCode } from "@modules/domain/cells"
import { FIXTURE_PACKAGES, buildSeed, edited, packageFiles } from "@tests/fixtures/builders/cells-seed.builder"

const MONEY = "demo-money"
const CRM = "demo-crm-lead"
const NODE = `${MONEY}/cells/node/demo.ask-to-pay/v1`
const MONEY_NODE_YAML = "cells/node/demo.ask-to-pay/v1/cell.yaml"
const MONEY_NODE_JS = "cells/node/demo.ask-to-pay/v1/run.js"
const MONEY_GRAPH = "graphs/demo.payment/v1/graph.yaml"
const CRM_GRAPH = "graphs/demo.lead-intake/v1/graph.yaml"
const ASK_REF = "node:demo.ask-to-pay@1"
const PAYMENT_REF = "graph:demo.payment@1"
const CREATE_YAML = "cells/tool/nivo.tool.payment.request.create/v1/cell.yaml"

/** The refusals of a check, by ref (the check prints `refused <ref> <CODE> <params>`). */
const refusalsOf = (lines: ReadonlyArray<string>): Record<string, string> =>
    Object.fromEntries(
        lines
            .filter((line) => line.startsWith("refused "))
            .map((line) => {
                const [, ref = "", code = ""] = line.split(" ")
                return [ref, code]
            }),
    )

const checkMoney = async (change: (files: Map<string, string>) => Map<string, string>, problems: ReadonlyArray<string> = []): Promise<Record<string, string>> => {
    const { seed } = await buildSeed({ problems })
    return refusalsOf((await seed.check(change(packageFiles(MONEY)))).lines)
}

const crmWith = async (graph: string): Promise<Record<string, string>> => {
    const { seed } = await buildSeed()
    return refusalsOf((await seed.check(edited(packageFiles(CRM), CRM_GRAPH, () => graph))).lines)
}

const textIn = (path: string, from: string, to: string) => (files: Map<string, string>) => edited(files, path, (text) => {
    if (!text.includes(from)) throw new Error(`fixture edit missed: ${from}`)
    return text.replace(from, to)
})

describe("CellValidationService through the seed check", () => {
    it.each(FIXTURE_PACKAGES)("%s: every cell and graph passes and the check prints READY", async (name) => {
        const { seed } = await buildSeed()

        const view = await seed.check(packageFiles(name))

        expect(view.ready).toBe(true)
        expect(view.lines.at(-1)).toBe("READY")
        expect(refusalsOf(view.lines)).toEqual({})
    })

    it("CELLS_SCHEMA_INVALID: a schema with an unknown type", async () => {
        const refused = await checkMoney(textIn(MONEY_NODE_YAML, "properties: { payKey: { type: string } } }", "properties: { payKey: { type: strng } } }"))

        expect(refused[ASK_REF]).toBe(CellsErrorCode.SchemaInvalid)
        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.GraphRefUnknown)
    })

    it("CELLS_BODY_INVALID: a body member outside the kind's shape", async () => {
        const refused = await checkMoney(textIn("cells/tool/nivo.tool.customer.message.send/v1/cell.yaml", "account: any", "account: sometimes"))

        expect(refused["tool:nivo.tool.customer.message.send@1"]).toBe(CellsErrorCode.BodyInvalid)
    })

    it("CELLS_SEMANTICS_INVALID: finalRefusals that are not in refusals, and the node that names that refused tool", async () => {
        const refused = await checkMoney(textIn(CREATE_YAML, "finalRefusals: [account_closed]", "finalRefusals: [nope]"))

        expect(refused["tool:nivo.tool.payment.request.create@1"]).toBe(CellsErrorCode.SemanticsInvalid)
        expect(refused[ASK_REF]).toBe(CellsErrorCode.SemanticsInvalid)
    })

    it("CELLS_SEMANTICS_INVALID: final refusals on a read, a node with no source, a source on a tool", async () => {
        const onRead = await checkMoney(
            textIn("cells/tool/nivo.tool.payment.request.read/v1/cell.yaml", "semantics: { mutates: false, refusals: [not_found] }", "semantics: { mutates: false, finalRefusals: [not_found], refusals: [not_found] }"),
        )
        const noSource = await checkMoney(textIn(MONEY_NODE_YAML, "source: run.js\norigin: run.ts\n", ""))
        const readYaml = "cells/tool/nivo.tool.payment.request.read/v1/cell.yaml"
        const sourceOnTool = await checkMoney((files) => edited(textIn(readYaml, "semantics:", "source: x.js\nsemantics:")(files), readYaml.replace("cell.yaml", "x.js"), () => "function x() {}\n"))

        expect(onRead["tool:nivo.tool.payment.request.read@1"]).toBe(CellsErrorCode.SemanticsInvalid)
        expect(noSource[ASK_REF]).toBe(CellsErrorCode.SemanticsInvalid)
        expect(sourceOnTool["tool:nivo.tool.payment.request.read@1"]).toBe(CellsErrorCode.SemanticsInvalid)
    })

    it.each([
        ["an import", 'import x from "y"\n'],
        ["an export", "export const a = 1\n"],
        ["a require call", 'const a = require("fs")\n'],
        ["a dynamic import", 'const a = import("y")\n'],
        ["eval", 'eval("1")\n'],
        ["new Function", 'const a = new Function("return 1")\n'],
    ])("CELLS_SOURCE_IMPORTS: %s in the compiled source", async (_name, line) => {
        const refused = await checkMoney(textIn(MONEY_NODE_JS, "function run", `${line}function run`))

        expect(refused[ASK_REF]).toBe(CellsErrorCode.SourceImports)
    })

    it("a module word in a string, a comment or a property name is not a use", async () => {
        const refused = await checkMoney(textIn(MONEY_NODE_JS, "function run", '// import x from "y"\nconst note = "require(a) and export"\nconst o = { import: 1 }\nfunction run'))

        expect(refused).toEqual({})
    })

    it("CELLS_SOURCE_SYNTAX: the runner's check problems, and a source with no entry function", async () => {
        const runnerSays = await checkMoney((files) => files, ["unexpected token"])
        const noEntry = await checkMoney(textIn(MONEY_NODE_JS, "function run(", "function go("))

        expect(runnerSays[ASK_REF]).toBe(CellsErrorCode.SourceSyntax)
        expect(runnerSays["trigger:demo.bank-credit@1"]).toBe(CellsErrorCode.SourceSyntax)
        expect(noEntry[ASK_REF]).toBe(CellsErrorCode.SourceSyntax)
    })

    it("CELLS_SOURCE_SYNTAX: a script the parser rejects", async () => {
        const refused = await checkMoney(textIn(MONEY_NODE_JS, "function run", "function run(((("))

        expect(refused[ASK_REF]).toBe(CellsErrorCode.SourceSyntax)
    })

    it("CELLS_TOOL_UNDECLARED: a source that calls a tool the cell does not declare, and an example that answers one", async () => {
        const inSource = await checkMoney(textIn(MONEY_NODE_JS, "return { payKey", 'ctx.tool("nivo.tool.other", {})\n  return { payKey'))
        const inExample = await checkMoney(textIn(MONEY_NODE_YAML, "- { id: nivo.tool.customer.message.send,", "- { id: nivo.tool.other,"))

        expect(inSource[ASK_REF]).toBe(CellsErrorCode.ToolUndeclared)
        expect(inExample[ASK_REF]).toBe(CellsErrorCode.ToolUndeclared)
    })

    it("CELLS_REFUSAL_UNDECLARED: an example that expects a refusal the cell does not declare", async () => {
        const refused = await checkMoney(
            textIn("cells/tool/nivo.tool.payment.request.read/v1/cell.yaml", "body:", "examples:\n  - { name: x, input: { payKey: A }, expect: { refused: unlisted } }\nbody:"),
        )

        expect(refused["tool:nivo.tool.payment.request.read@1"]).toBe(CellsErrorCode.RefusalUndeclared)
    })

    it("CELLS_EXAMPLE_FAILED: two examples with one name", async () => {
        const refused = await checkMoney(textIn(MONEY_NODE_YAML, "cannot when the request is refused", "asks 350,000 for DH1001"))

        expect(refused[ASK_REF]).toBe(CellsErrorCode.ExampleFailed)
    })

    it("CELLS_PACKAGE_INVALID: a cell whose file does not say what its folder says, and a missing source file", async () => {
        const wrongKey = await checkMoney(textIn("cells/tool/nivo.tool.payment.request.read/v1/cell.yaml", "key: nivo.tool.payment.request.read", "key: other"))
        const missing = await checkMoney((files) => new Map([...files].filter(([path]) => path !== `${NODE.replace(`${MONEY}/`, "")}/run.js`)))

        expect(wrongKey["tool:nivo.tool.payment.request.read@1"]).toBe(CellsErrorCode.PackageInvalid)
        expect(Object.values(missing)).toContain(CellsErrorCode.PackageInvalid)
    })

    it("CELLS_GRAPH_REF_UNKNOWN: a step that names a cell version that is not there", async () => {
        const refused = await checkMoney(textIn(MONEY_GRAPH, "key: demo.ask-to-pay, version: 1", "key: demo.ask-to-pay, version: 2"))

        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.GraphRefUnknown)
    })

    it("CELLS_KIND_MISMATCH: a node step that names a tool", async () => {
        const refused = await checkMoney(textIn(MONEY_GRAPH, "cell: { kind: node, key: demo.ask-to-pay, version: 1 }", "cell: { kind: tool, key: nivo.tool.customer.message.send, version: 1 }"))

        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.KindMismatch)
    })

    it("CELLS_GRAPH_ROUTE_MISSING: a route to a step that does not exist", async () => {
        const refused = await checkMoney(textIn(MONEY_GRAPH, "no: ask", "no: nowhere"))

        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.GraphRouteMissing)
    })

    it("CELLS_GRAPH_CYCLE: a route that leads back outside a loop", async () => {
        const refused = await checkMoney(textIn(MONEY_GRAPH, "onTimeout: unpaid", "onTimeout: remember"))

        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.GraphCycle)
    })

    it("CELLS_EXPR_INVALID: an unknown operator, an expression deeper than 4, an order comparison of text, a ref to a step or member that is not there, item outside a loop", async () => {
        const operator = await checkMoney(textIn(MONEY_GRAPH, "op: gte", "op: gtx"))
        const deep = await checkMoney(
            textIn(MONEY_GRAPH, "when: { op: gte, ref: { $ref: vars.paidAmount }, value: { $ref: trigger.data.total } }", "when: { not: { not: { not: { not: { op: present, ref: { $ref: trigger.data.x } } } } } }"),
        )
        const text = await checkMoney(textIn(MONEY_GRAPH, "value: { $ref: trigger.data.total } }\n    yes", "value: big }\n    yes"))
        const member = await checkMoney(textIn(MONEY_GRAPH, "steps.ask.output.payKey", "steps.ask.output.nope"))
        const step = await checkMoney(textIn(MONEY_GRAPH, "steps.ask.output.payKey", "steps.zzz.output.payKey"))
        const item = await checkMoney(textIn(MONEY_GRAPH, "total: { $ref: trigger.data.total } }\n    mode", "total: { $ref: item.x } }\n    mode"))

        for (const refused of [operator, deep, text, member, step, item]) expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.ExprInvalid)
    })

    it("CELLS_BODY_INVALID: a control step whose config is wrong (a wait with six keys, a loop with max 51)", async () => {
        const keys = "        - { verb: nivo.trigger.payment.credit.received, where: { op: present, ref: { $ref: trigger.data.creditId } } }\n"
        const wait = await checkMoney(textIn(MONEY_GRAPH, keys, keys.repeat(6)))
        const loop = await crmWith((await packageText(CRM, CRM_GRAPH)).replace("max: 50", "max: 51"))

        expect(wait[PAYMENT_REF]).toBe(CellsErrorCode.BodyInvalid)
        expect(loop["graph:demo.lead-intake@1"]).toBe(CellsErrorCode.BodyInvalid)
    })

    it("CELLS_VAR_UNDECLARED: a core.set of a variable the graph does not declare, and a ref to one", async () => {
        const set = await checkMoney(textIn(MONEY_GRAPH, "vars:\n  paidAmount: { schema: { type: number } }\n", "vars:\n  other: { schema: { type: number } }\n"))
        const read = await checkMoney(textIn(MONEY_GRAPH, "amountVnd: { $ref: vars.paidAmount }", "amountVnd: { $ref: vars.ghost }"))

        expect(set[PAYMENT_REF]).toBe(CellsErrorCode.VarUndeclared)
        expect(read[PAYMENT_REF]).toBe(CellsErrorCode.VarUndeclared)
    })

    describe("parallel writes of one variable (D1)", () => {
        const body = (merge: string, schema: string, value: string): Promise<Record<string, string>> =>
            packageText(CRM, CRM_GRAPH).then((graph) =>
                crmWith(
                    graph
                        .replace("steps:\n  each:", `vars:\n  seen: { schema: ${schema}${merge} }\nsteps:\n  each:`)
                        .replace("concurrency: 1", "concurrency: 3")
                        .replace("accounts: [demo-crm]\n      next: done", `accounts: [demo-crm]\n            next: mark\n          mark:\n            kind: core.set\n            config: { set: { seen: ${value} } }\n      next: done`),
                ),
            )

        it("CELLS_VAR_WRITE_CONFLICT: iterations that run at once write a variable that declares no merge", async () => {
            expect((await body("", "{ type: number }", "1"))["graph:demo.lead-intake@1"]).toBe(CellsErrorCode.VarWriteConflict)
        })

        it("a variable that declares merge append may be written in parallel", async () => {
            expect(await body(", merge: append", "{ type: array }", "[1]")).toEqual({})
        })

        it("the same write is fine while the loop runs one iteration at a time", async () => {
            const graph = (await packageText(CRM, CRM_GRAPH))
                .replace("steps:\n  each:", "vars:\n  seen: { schema: { type: number } }\nsteps:\n  each:")
                .replace("accounts: [demo-crm]\n      next: done", "accounts: [demo-crm]\n            next: mark\n          mark:\n            kind: core.set\n            config: { set: { seen: 1 } }\n      next: done")

            expect(await crmWith(graph)).toEqual({})
        })
    })

    it("a package with no manifest, or a private one that names no enterprise, is refused whole", async () => {
        const { seed } = await buildSeed()
        const withoutManifest = new Map([...packageFiles(MONEY)].filter(([path]) => path !== "cells.package.yaml"))
        const privateNone = edited(packageFiles(MONEY), "cells.package.yaml", (text) => text.replace("public", "private"))

        await expect(seed.check(withoutManifest)).rejects.toBeInstanceOf(CellsError)
        await expect(seed.check(privateNone)).rejects.toMatchObject({ code: CellsErrorCode.PackageInvalid })
    })
})

/** The text of one fixture file. */
const packageText = (name: string, path: string): Promise<string> => Promise.resolve(packageFiles(name).get(path) ?? "")
