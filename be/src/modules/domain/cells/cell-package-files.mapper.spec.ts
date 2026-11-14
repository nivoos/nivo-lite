import { CellsErrorCode } from "./errors/cells.error"
import { cellRefText, graphRefText, readCellPackage, readPackageManifest, validatedCellOf, validatedGraphOf } from "./cell-package-files.mapper"
import { FIXTURE_PACKAGES, edited, packageFiles } from "@tests/fixtures/builders/cells-seed.builder"

const MANIFEST = "key: demo-x\nversion: 1.2.3\nvisibility: public\nauthor: A\n"
const CELL = 'kind: tool\nkey: t\nversion: 1\ntitle: { vi: "a", en: "b" }\ninput: { type: object }\noutput: { type: object }\nsemantics: { mutates: false }\nbody: { account: none, servedBy: "primitive:x" }\n'
const GRAPH = "key: g\nversion: 1\nstart: a\ntriggers: []\nsteps: { a: { kind: core.outcome, config: { name: x } } }\n"

const filesOf = (more: Record<string, string>): Map<string, string> => new Map(Object.entries({ "cells.package.yaml": MANIFEST, ...more }))

const faultsOf = (more: Record<string, string>): ReadonlyArray<string> => readCellPackage(filesOf(more)).faults.map((fault) => `${fault.dir}: ${fault.reason}`)

describe("readCellPackage", () => {
    it.each(FIXTURE_PACKAGES)("reads the fixture %s into cells and graphs with no fault, and ignores every other file", (name) => {
        const files = edited(packageFiles(name), "README.md", () => "x")

        const content = readCellPackage(files)

        expect(content.faults).toEqual([])
        expect(content.cells.length).toBeGreaterThan(5)
        expect(content.graphs).toHaveLength(1)
        expect(content.manifest.key).toBe(name)
    })

    it("gives a source its text with the line ends normalized, and the origin file name", () => {
        const content = readCellPackage(edited(packageFiles("demo-money"), "cells/node/demo.ask-to-pay/v1/run.js", (text) => text.replaceAll("\n", "\r\n")))

        const node = content.cells.find((cell) => cell.file.key === "demo.ask-to-pay")

        expect(node?.sourceText).not.toContain("\r")
        expect(node?.origin).toBe("run.ts")
    })

    it("a cell file is a fault of that one cell when it is not what its folder says", () => {
        const faults = faultsOf({
            "cells/tool/t/v1/cell.yaml": CELL,
            "cells/tool/a/v1/cell.yaml": CELL,
            "cells/tool/b/v2/cell.yaml": CELL,
            "cells/zzz/c/v1/cell.yaml": CELL.replace("kind: tool", "kind: zzz").replace("key: t", "key: c"),
            "cells/tool/d/v1/cell.yaml": CELL.replace("key: t", "key: d").replace("title: { vi: \"a\", en: \"b\" }", "title: { vi: a }"),
            "cells/tool/e/v1/cell.yaml": `${CELL.replace("key: t", "key: e")}stray: 1\n`,
            "cells/tool/f/v1/cell.yaml": "- 1\n",
            "cells/tool/g/v1/cell.yaml": "a: [\n",
            "cells/tool/h/v1/cell.yaml": `${CELL.replace("key: t", "key: h")}source: ../x.js\n`,
            "cells/tool/i/v1/cell.yaml": `${CELL.replace("key: t", "key: i")}origin: run.ts\n`,
            "cells/tool/j/v1/cell.yaml": `${CELL.replace("key: t", "key: j")}source: j.js\norigin: j.ts\n`,
            "cells/tool/k/v1/cell.yaml": `${CELL.replace("key: t", "key: k")}reviewState: gone\n`,
            "cells/tool/l/v1/cell.yaml": `${CELL.replace("key: t", "key: l")}examples: [1]\n`,
            "cells/tool/m/v1/cell.yaml": CELL.replace("key: t", "key: m").replace("input: { type: object }", "input: 1"),
            "cells/tool/n/v1/cell.yaml": CELL.replace("key: t", "key: n").replace(/body:.*\n/u, "body: 1\n"),
            "cells/tool/o/v1/cell.yaml": `${CELL.replace("key: t", "key: o")}config: 1\n`,
        })

        expect(faults).toEqual(
            expect.arrayContaining([
                expect.stringContaining("cells/tool/a/v1: key: must be a"),
                expect.stringContaining("cells/tool/b/v2: key: must be b"),
                expect.stringContaining("cells/zzz/c/v1: kind"),
                expect.stringContaining("cells/tool/d/v1: title: needs vi and en"),
                expect.stringContaining("cells/tool/e/v1: unknown member stray"),
                expect.stringContaining("cells/tool/f/v1: must be a mapping"),
                expect.stringContaining("cells/tool/g/v1:"),
                expect.stringContaining("cells/tool/h/v1: source"),
                expect.stringContaining("cells/tool/i/v1: origin"),
                expect.stringContaining("cells/tool/j/v1: the origin file named in cell.yaml is missing"),
                expect.stringContaining("cells/tool/k/v1: reviewState"),
                expect.stringContaining("cells/tool/l/v1: examples"),
                expect.stringContaining("cells/tool/m/v1: input, output and semantics"),
                expect.stringContaining("cells/tool/n/v1: body"),
                expect.stringContaining("cells/tool/o/v1: config"),
            ]),
        )
        expect(faults.some((fault) => fault.startsWith("cells/tool/t/v1"))).toBe(false)
    })

    it("an origin file that is not beside the cell is a fault", () => {
        const faults = faultsOf({ "cells/tool/j/v1/cell.yaml": `${CELL.replace("key: t", "key: j")}source: j.js\norigin: j.ts\n`, "cells/tool/j/v1/j.js": "x" })

        expect(faults).toEqual(["cells/tool/j/v1: the origin file named in cell.yaml is missing"])
    })

    it("a graph file is a fault of that one graph when it is not what its folder says", () => {
        const faults = faultsOf({
            "graphs/g/v1/graph.yaml": GRAPH,
            "graphs/h/v1/graph.yaml": GRAPH,
            "graphs/g/v2/graph.yaml": GRAPH,
            "graphs/i/v1/graph.yaml": GRAPH.replace("key: g", "key: i").replace("start: a", ""),
            "graphs/j/v1/graph.yaml": GRAPH.replace("key: g", "key: j").replace("triggers: []", "triggers: 1"),
            "graphs/k/v1/graph.yaml": GRAPH.replace("key: g", "key: k").replace("steps: {", "steps: { z: 1,"),
            "graphs/l/v1/graph.yaml": `${GRAPH.replace("key: g", "key: l")}reviewState: retired\n`,
            "graphs/m/v1/graph.yaml": `${GRAPH.replace("key: g", "key: m")}vars: 1\n`,
            "graphs/n/v1/graph.yaml": `${GRAPH.replace("key: g", "key: n")}stray: 1\n`,
            "graphs/o/v1/graph.yaml": GRAPH.replace("key: g", "key: o").replace("steps: {", "steps: 1 #"),
            "graphs/p/v1/graph.yaml": "- 1\n",
            "graphs/q/v1/graph.yaml": "a: [\n",
        })

        expect(faults.map((fault) => fault.split(":")[0])).toEqual(expect.arrayContaining(["graphs/h/v1", "graphs/g/v2", "graphs/i/v1", "graphs/j/v1", "graphs/k/v1", "graphs/l/v1", "graphs/m/v1", "graphs/n/v1", "graphs/o/v1", "graphs/p/v1", "graphs/q/v1"]))
        expect(faults.some((fault) => fault.startsWith("graphs/g/v1"))).toBe(false)
    })

    it("refuses a package whose manifest is missing or wrong, with CELLS_PACKAGE_INVALID", () => {
        const wrong = (text: string): unknown => {
            try {
                readPackageManifest(new Map([["cells.package.yaml", text]]))
                return null
            } catch (cause: unknown) {
                return Reflect.get(Object(cause), "code")
            }
        }

        expect(wrong("a: [\n")).toBe(CellsErrorCode.PackageInvalid)
        expect(wrong("- 1")).toBe(CellsErrorCode.PackageInvalid)
        expect(wrong(`${MANIFEST}stray: 1`)).toBe(CellsErrorCode.PackageInvalid)
        expect(wrong(MANIFEST.replace("demo-x", "Bad Key"))).toBe(CellsErrorCode.PackageInvalid)
        expect(wrong(MANIFEST.replace("1.2.3", "1"))).toBe(CellsErrorCode.PackageInvalid)
        expect(wrong(MANIFEST.replace("public", "secret"))).toBe(CellsErrorCode.PackageInvalid)
        expect(wrong(MANIFEST.replace("author: A", "author: ''"))).toBe(CellsErrorCode.PackageInvalid)
        expect(wrong(`${MANIFEST}enterprises: [e]`)).toBe(CellsErrorCode.PackageInvalid)
        expect(wrong(MANIFEST.replace("public", "private"))).toBe(CellsErrorCode.PackageInvalid)
        expect(() => readPackageManifest(new Map())).toThrow()
        expect(readPackageManifest(new Map([["cells.package.yaml", `${MANIFEST.replace("public", "private")}enterprises: [e1]\n`]]))).toEqual({
            key: "demo-x",
            version: "1.2.3",
            visibility: "private",
            author: "A",
            enterprises: ["e1"],
        })
    })
})

describe("the row mappers", () => {
    it("turns a cell file into a row with the defaults a file may leave out", () => {
        const [cell] = readCellPackage(filesOf({ "cells/tool/t/v1/cell.yaml": CELL })).cells

        const row = validatedCellOf(cell?.file as never, null, "repo@abc")

        expect(row).toMatchObject({ kind: "tool", key: "t", version: 1, body: { account: "none", servedBy: "primitive:x" }, examples: [], reviewState: "approved", reviewRef: "repo@abc", source: null })
        expect(row.configSchema).toEqual({ type: "object", properties: {}, additionalProperties: false })
        expect(cellRefText(row)).toBe("tool:t@1")
    })

    it("a retired file is written approved (the writer retires it), an absent body is empty", () => {
        const [cell] = readCellPackage(filesOf({ "cells/tool/t/v1/cell.yaml": `${CELL.replace(/body:.*\n/u, "")}reviewState: retired\n` })).cells

        expect(validatedCellOf(cell?.file as never, null, "r")).toMatchObject({ reviewState: "approved", body: {} })
    })

    it("turns a graph file into a row, keeping its variables", () => {
        const [graph] = readCellPackage(filesOf({ "graphs/g/v1/graph.yaml": `${GRAPH}vars: { v: { schema: { type: number } } }\nreviewState: draft\n` })).graphs

        const row = validatedGraphOf(graph?.file as never, "r")

        expect(row).toMatchObject({ key: "g", version: 1, reviewState: "draft", document: { start: "a", vars: { v: { schema: { type: "number" } } } } })
        expect(graphRefText(row)).toBe("graph:g@1")
        expect(validatedGraphOf({ ...(graph?.file as never as object), vars: undefined } as never, "r").document).not.toHaveProperty("vars")
    })
})
