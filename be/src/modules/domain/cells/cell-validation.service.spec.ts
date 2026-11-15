import { CellsError, CellsErrorCode } from "@modules/domain/cells"
import {
    FIXTURE_PACKAGES,
    buildSeed,
    edited,
    editedYaml,
    packageFiles,
    type YamlDocument,
} from "@tests/fixtures/builders/cells-seed.builder"

const MONEY = "demo-money"
const CRM = "demo-crm-lead"
const NODE_YAML = "cells/node/demo.ask-to-pay/v1/cell.yaml"
const NODE_JS = "cells/node/demo.ask-to-pay/v1/run.js"
const MONEY_GRAPH = "graphs/demo.payment/v1/graph.yaml"
const CRM_GRAPH = "graphs/demo.lead-intake/v1/graph.yaml"
const READ_YAML = "cells/tool/nivo.tool.payment.request.read/v1/cell.yaml"
const CREATE_YAML = "cells/tool/nivo.tool.payment.request.create/v1/cell.yaml"
const SEND_YAML = "cells/tool/nivo.tool.customer.message.send/v1/cell.yaml"
const ASK_REF = "node:demo.ask-to-pay@1"
const READ_REF = "tool:nivo.tool.payment.request.read@1"
const PAYMENT_REF = "graph:demo.payment@1"
const LEAD_REF = "graph:demo.lead-intake@1"

type Files = Map<string, string>

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

const check = async (files: Files, problems: ReadonlyArray<string> = []): Promise<Record<string, string>> => {
    const { seed } = await buildSeed({ problems })
    return refusalsOf((await seed.check(files)).lines)
}

const money = (
    change: (files: Files) => Files = (files) => files,
    problems: ReadonlyArray<string> = [],
): Promise<Record<string, string>> => check(change(packageFiles(MONEY)), problems)

/** A change to one yaml file of the money package. */
const yamlChange =
    (path: string, mutate: (document: YamlDocument) => void) =>
    (files: Files): Files =>
        editedYaml(files, path, mutate)

/** A change to the money graph. */
const graphChange = (mutate: (graph: YamlDocument) => void) => yamlChange(MONEY_GRAPH, mutate)

/** A change to the text of the node source. */
const sourceChange =
    (change: (text: string) => string) =>
    (files: Files): Files =>
        edited(files, NODE_JS, change)

/** The crm graph with the loop body's `file` step followed by a `core.set` of the variable `seen`, the loop running `concurrency` at once. */
const crmSetting = (
    declaration: YamlDocument | null,
    value: YamlDocument,
    concurrency: number,
): Promise<Record<string, string>> =>
    check(
        editedYaml(packageFiles(CRM), CRM_GRAPH, (graph) => {
            if (declaration !== null) graph.vars = { seen: declaration }
            const config = graph.steps.each.config
            config.concurrency = concurrency
            config.body.steps.file.next = "mark"
            config.body.steps.mark = { kind: "core.set", config: { set: { seen: value } } }
        }),
    )

describe("CellValidationService through the seed check", () => {
    it.each(FIXTURE_PACKAGES)("%s: every cell and graph passes and the check prints READY", async (name) => {
        const { seed } = await buildSeed()

        const view = await seed.check(packageFiles(name))

        expect(view.ready).toBe(true)
        expect(view.lines.at(-1)).toBe("READY")
        expect(refusalsOf(view.lines)).toEqual({})
    })

    it("CELLS_SCHEMA_INVALID: a schema with an unknown type, and the graph that needs the refused node", async () => {
        const refused = await money(
            yamlChange(NODE_YAML, (cell) => {
                cell.output.properties.payKey.type = "strng"
            }),
        )

        expect(refused[ASK_REF]).toBe(CellsErrorCode.SchemaInvalid)
        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.GraphRefUnknown)
    })

    it("CELLS_SCHEMA_INVALID: an input schema that is not an object", async () => {
        const refused = await money(
            yamlChange(SEND_YAML, (cell) => {
                cell.input = { type: "string" }
            }),
        )

        expect(refused["tool:nivo.tool.customer.message.send@1"]).toBe(CellsErrorCode.SchemaInvalid)
    })

    it("CELLS_BODY_INVALID: a body member outside the kind's shape", async () => {
        const refused = await money(
            yamlChange(SEND_YAML, (cell) => {
                cell.body.account = "sometimes"
            }),
        )

        expect(refused["tool:nivo.tool.customer.message.send@1"]).toBe(CellsErrorCode.BodyInvalid)
    })

    it("CELLS_SEMANTICS_INVALID: finalRefusals that are not in refusals, and the node that names that refused tool", async () => {
        const refused = await money(
            yamlChange(CREATE_YAML, (cell) => {
                cell.semantics.finalRefusals = ["nope"]
            }),
        )

        expect(refused["tool:nivo.tool.payment.request.create@1"]).toBe(CellsErrorCode.SemanticsInvalid)
        expect(refused[ASK_REF]).toBe(CellsErrorCode.SemanticsInvalid)
    })

    it("CELLS_SEMANTICS_INVALID: final refusals on a read, a node with no source, a source on a tool", async () => {
        const onRead = await money(
            yamlChange(READ_YAML, (cell) => {
                cell.semantics.finalRefusals = ["not_found"]
            }),
        )
        const noSource = await money(
            yamlChange(NODE_YAML, (cell) => {
                delete cell.source
                delete cell.origin
            }),
        )
        const sourceOnTool = await money((files) =>
            edited(
                yamlChange(READ_YAML, (cell) => {
                    cell.source = "x.js"
                })(files),
                READ_YAML.replace("cell.yaml", "x.js"),
                () => "function x() {}\n",
            ),
        )

        expect(onRead[READ_REF]).toBe(CellsErrorCode.SemanticsInvalid)
        expect(noSource[ASK_REF]).toBe(CellsErrorCode.SemanticsInvalid)
        expect(sourceOnTool[READ_REF]).toBe(CellsErrorCode.SemanticsInvalid)
    })

    it.each([
        ["an import", 'import x from "y"\n'],
        ["an export", "export const a = 1\n"],
        ["a require call", 'const a = require("fs")\n'],
        ["a dynamic import", 'const a = import("y")\n'],
        ["eval", 'eval("1")\n'],
        ["new Function", 'const a = new Function("return 1")\n'],
    ])("CELLS_SOURCE_IMPORTS: %s in the compiled source", async (_name, line) => {
        const refused = await money(sourceChange((text) => `${line}${text}`))

        expect(refused[ASK_REF]).toBe(CellsErrorCode.SourceImports)
    })

    it("a module word in a string, a comment or a property name is not a use", async () => {
        const refused = await money(
            sourceChange(
                (text) =>
                    `// import x from "y"\nconst note = "require(a) and export"\nconst o = { import: 1 }\n${text}`,
            ),
        )

        expect(refused).toEqual({})
    })

    it("CELLS_SOURCE_SYNTAX: the runner's check problems, and a source with no entry function", async () => {
        const runnerSays = await money(undefined, ["unexpected token"])
        const noEntry = await money(sourceChange((text) => text.replace("function run(", "function go(")))

        expect(runnerSays[ASK_REF]).toBe(CellsErrorCode.SourceSyntax)
        expect(runnerSays["trigger:demo.bank-credit@1"]).toBe(CellsErrorCode.SourceSyntax)
        expect(noEntry[ASK_REF]).toBe(CellsErrorCode.SourceSyntax)
    })

    it("CELLS_SOURCE_SYNTAX: an async entry or any await (C1: the guest is synchronous), on both fixture kinds", async () => {
        const asyncEntry = await money(sourceChange((text) => text.replace("function run(", "async function run(")))
        const lead = await check(
            edited(
                packageFiles(CRM),
                "cells/node/demo.file-lead/v1/run.js",
                (text) => `${text}\nconst later = async () => 1\n`,
            ),
        )

        expect(asyncEntry[ASK_REF]).toBe(CellsErrorCode.SourceSyntax)
        expect(lead["node:demo.file-lead@1"]).toBe(CellsErrorCode.SourceSyntax)
    })

    it("CELLS_SOURCE_SYNTAX: a script the parser rejects", async () => {
        const refused = await money(sourceChange((text) => `${text}\nfunction broken(((((\n`))

        expect(refused[ASK_REF]).toBe(CellsErrorCode.SourceSyntax)
    })

    it("CELLS_TOOL_UNDECLARED: a source that calls a tool the cell does not declare, and an example that answers one", async () => {
        const inSource = await money(sourceChange((text) => `${text}\nctx.tool("nivo.tool.other", {})\n`))
        const inExample = await money(
            yamlChange(NODE_YAML, (cell) => {
                cell.examples[0].tools[1].id = "nivo.tool.other"
            }),
        )

        expect(inSource[ASK_REF]).toBe(CellsErrorCode.ToolUndeclared)
        expect(inExample[ASK_REF]).toBe(CellsErrorCode.ToolUndeclared)
    })

    it("CELLS_REFUSAL_UNDECLARED: an example that expects a refusal the cell does not declare", async () => {
        const refused = await money(
            yamlChange(READ_YAML, (cell) => {
                cell.examples = [{ name: "x", input: { payKey: "A" }, expect: { refused: "unlisted" } }]
            }),
        )

        expect(refused[READ_REF]).toBe(CellsErrorCode.RefusalUndeclared)
    })

    it("CELLS_EXAMPLE_FAILED: two examples with one name, and an example that expects two things", async () => {
        const twice = await money(
            yamlChange(NODE_YAML, (cell) => {
                cell.examples[1].name = cell.examples[0].name
            }),
        )
        const both = await money(
            yamlChange(NODE_YAML, (cell) => {
                cell.examples[1].expect = { ok: {}, ending: "cannot" }
            }),
        )

        expect(twice[ASK_REF]).toBe(CellsErrorCode.ExampleFailed)
        expect(both[ASK_REF]).toBe(CellsErrorCode.ExampleFailed)
    })

    it("CELLS_PACKAGE_INVALID: a cell whose file does not say what its folder says, and a missing source file", async () => {
        const wrongKey = await money(
            yamlChange(READ_YAML, (cell) => {
                cell.key = "other"
            }),
        )
        const missing = await money((files) => new Map([...files].filter(([path]) => path !== NODE_JS)))

        expect(wrongKey[READ_REF]).toBe(CellsErrorCode.PackageInvalid)
        expect(missing[ASK_REF]).toBe(CellsErrorCode.PackageInvalid)
    })

    it("CELLS_GRAPH_REF_UNKNOWN: a step that names a cell version that is not there", async () => {
        const refused = await money(
            graphChange((graph) => {
                graph.steps.ask.cell.version = 2
            }),
        )

        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.GraphRefUnknown)
    })

    it("CELLS_KIND_MISMATCH: a node step that names a tool", async () => {
        const refused = await money(
            graphChange((graph) => {
                graph.steps.ask.cell = { kind: "tool", key: "nivo.tool.customer.message.send", version: 1 }
            }),
        )

        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.KindMismatch)
    })

    it("CELLS_GRAPH_ROUTE_MISSING: a route to a step that does not exist", async () => {
        const refused = await money(
            graphChange((graph) => {
                graph.steps.match.no = "nowhere"
            }),
        )

        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.GraphRouteMissing)
    })

    it("CELLS_GRAPH_CYCLE: a route that leads back outside a loop", async () => {
        const refused = await money(
            graphChange((graph) => {
                graph.steps.wait.config.onTimeout = "remember"
            }),
        )

        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.GraphCycle)
    })

    it.each([
        ["an unknown operator", (graph: YamlDocument) => (graph.steps.match.when.op = "gtx")],
        [
            "an expression deeper than 4",
            (graph: YamlDocument) =>
                (graph.steps.match.when = {
                    not: { not: { not: { not: { op: "present", ref: { $ref: "trigger.data.x" } } } } },
                }),
        ],
        ["an order comparison of text", (graph: YamlDocument) => (graph.steps.match.when.value = "big")],
        [
            "a ref to a member the node's output does not list",
            (graph: YamlDocument) => (graph.steps.paid.config.output.payKey.$ref = "steps.ask.output.nope"),
        ],
        [
            "a ref to a step that is not there",
            (graph: YamlDocument) => (graph.steps.paid.config.output.payKey.$ref = "steps.zzz.output.payKey"),
        ],
        ["item outside a loop", (graph: YamlDocument) => (graph.steps.ask.input.total.$ref = "item.x")],
    ])("CELLS_EXPR_INVALID: %s", async (_name, mutate) => {
        const refused = await money(graphChange(mutate))

        expect(refused[PAYMENT_REF]).toBe(CellsErrorCode.ExprInvalid)
    })

    it("CELLS_BODY_INVALID: a control step whose config is wrong (a wait with six keys, a loop with max 51)", async () => {
        const wait = await money(
            graphChange((graph) => {
                graph.steps.wait.config.keys = Array.from({ length: 6 }, () => ({ verb: "v" }))
            }),
        )
        const loop = await check(
            editedYaml(packageFiles(CRM), CRM_GRAPH, (graph) => {
                graph.steps.each.config.max = 51
            }),
        )

        expect(wait[PAYMENT_REF]).toBe(CellsErrorCode.BodyInvalid)
        expect(loop[LEAD_REF]).toBe(CellsErrorCode.BodyInvalid)
    })

    it("CELLS_VAR_UNDECLARED: a core.set of a variable the graph does not declare, and a ref to one", async () => {
        const set = await money(
            graphChange((graph) => {
                graph.vars = { other: { schema: { type: "number" } } }
            }),
        )
        const read = await money(
            graphChange((graph) => {
                graph.steps.paid.config.output.amountVnd.$ref = "vars.ghost"
            }),
        )

        expect(set[PAYMENT_REF]).toBe(CellsErrorCode.VarUndeclared)
        expect(read[PAYMENT_REF]).toBe(CellsErrorCode.VarUndeclared)
    })

    describe("parallel writes of one variable (D1)", () => {
        it("CELLS_VAR_WRITE_CONFLICT: iterations that run at once write a variable that declares no merge", async () => {
            expect((await crmSetting({ schema: { type: "number" } }, 1, 3))[LEAD_REF]).toBe(
                CellsErrorCode.VarWriteConflict,
            )
        })

        it("a variable that declares merge append may be written in parallel", async () => {
            expect(await crmSetting({ schema: { type: "array" }, merge: "append" }, [1], 3)).toEqual({})
        })

        it("the same write is fine while the loop runs one iteration at a time", async () => {
            expect(await crmSetting({ schema: { type: "number" } }, 1, 1)).toEqual({})
        })
    })

    it("a package with no manifest, or a private one that names no enterprise, is refused whole", async () => {
        const { seed } = await buildSeed()
        const withoutManifest = new Map([...packageFiles(MONEY)].filter(([path]) => path !== "cells.package.yaml"))
        const privateNone = editedYaml(packageFiles(MONEY), "cells.package.yaml", (manifest) => {
            manifest.visibility = "private"
        })

        await expect(seed.check(withoutManifest)).rejects.toBeInstanceOf(CellsError)
        await expect(seed.check(privateNone)).rejects.toMatchObject({ code: CellsErrorCode.PackageInvalid })
    })
})
