import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parse } from "yaml"
import demoCrmLead from "../test/authoring/demo-crm-lead.author"
import demoMoney from "../test/authoring/demo-money.author"
import { call, cellFile, graph, handBack, ifNode, loop, node, outcome, packageFile, project, ref, set, wait, when } from "./builders"
import { CompileError, compileSource } from "./compile"
import { diffFiles, emitProject, originOf } from "./emit"
import type { AuthorProject, CellFileData } from "./types"
import { yamlOf } from "./yaml"

const FIXTURES = resolve(__dirname, "../../../be/src/tests/fixtures/cells")
const readerOf =
    (files: Record<string, string>) =>
    (path: string): string | null =>
        files[path] ?? null
const diskOf =
    (root: string) =>
    (path: string): string | null => {
        try {
            return readFileSync(join(root, path), "utf8")
        } catch {
            return null
        }
    }

describe("compileSource", () => {
    const compile = (files: Record<string, string>, entry = "run.ts"): string => compileSource(entry, readerOf(files))
    const refusal = (files: Record<string, string>, entry = "run.ts"): string => {
        try {
            compile(files, entry)
        } catch (error: unknown) {
            if (error instanceof CompileError) return error.message
            throw error
        }
        return "compiled"
    }

    it("erases types and export and ends with exactly one newline", () => {
        const text = compile({
            "run.ts": `import type { NodeContext } from "@nivo-lite/cells-author"\ninterface In { readonly a: number }\nexport function run(input: In, ctx: NodeContext): number {\n  return input.a\n}\n`,
        })
        expect(text).toBe("function run(input, ctx) {\n    return input.a;\n}\n")
    })

    it("gives the same bytes twice, with LF line ends only", () => {
        const files = { "run.ts": `export function run(input: { a: number }) {\r\n  return { b: input.a }\r\n}\r\n` }
        expect(compile(files)).toBe("function run(input) {\n    return { b: input.a };\n}\n")
        expect(compile(files)).toBe(compile(files))
    })

    it("bundles a local helper in front of the entry once, with its export removed, and erases a type-only import", () => {
        const files = {
            "dir/run.ts": `import { double } from "./util"\nimport { FACTOR } from "./util.ts"\nimport { type Shape } from "./shapes"\nexport function run(input: { n: number }): number { return double(input.n) + FACTOR }`,
            "dir/util.ts": `export const FACTOR = 2\nexport function double(n: number): number { return n * FACTOR }`,
        }
        expect(compile(files, "dir/run.ts")).toBe(
            "const FACTOR = 2;\nfunction double(n) { return n * FACTOR; }\n\nfunction run(input) { return double(input.n) + FACTOR; }\n",
        )
    })

    it("refuses a package import, a renamed helper, a default import, a re-export, a default export and a missing file", () => {
        expect(refusal({ "run.ts": `import { x } from "lodash"\nexport function run() { return x }` })).toBe(
            `run.ts: imports "lodash": a cell source imports nothing but its own local helpers`,
        )
        expect(refusal({ "run.ts": `import { a as b } from "./u"\nfunction run() { return b }`, "u.ts": `export const a = 1` })).toBe(
            `run.ts: import of "./u" renames a name: helpers are bundled into one scope, keep their names`,
        )
        expect(refusal({ "run.ts": `import u from "./u"\nfunction run() { return u }`, "u.ts": `export default 1` })).toBe(`run.ts: import of "./u" must be \`import { name } from\``)
        expect(refusal({ "run.ts": `import * as u from "./u"\nfunction run() { return u }`, "u.ts": `export const a = 1` })).toBe(`run.ts: import of "./u" must be \`import { name } from\``)
        expect(refusal({ "run.ts": `import "./u"\nfunction run() { return 1 }`, "u.ts": `export const a = 1` })).toBe(`run.ts: import of "./u" must be \`import { name } from\``)
        expect(refusal({ "run.ts": `export { a } from "./u"`, "u.ts": `export const a = 1` })).toBe("run.ts: re-exports are not supported in a cell source")
        expect(refusal({ "run.ts": `export default function run() { return 1 }` })).toBe("run.ts: `export default` and `export =` are not supported in a cell source")
        expect(refusal({ "run.ts": `import { a } from "./gone"\nfunction run() { return a }` })).toBe("gone.ts: no such file")
    })

    it("refuses an import cycle and a top-level name two bundled files share", () => {
        expect(refusal({ "a.ts": `import { b } from "./b"\nexport const a = b`, "b.ts": `import { a } from "./a"\nexport const b = a` }, "a.ts")).toBe("a.ts: import cycle a.ts -> b.ts -> a.ts")
        expect(refusal({ "run.ts": `import { x } from "./u"\nfunction x() { return 2 }\nfunction run() { return x() }`, "u.ts": `export const x = 1` })).toBe(
            "run.ts: `x` is also declared in u.ts: bundled helpers share one scope",
        )
        expect(refusal({ "run.ts": `import { C } from "./u"\nclass D {}\nfunction run() { return new D() }`, "u.ts": `export class C {}\nexport const { a, b } = { a: 1, b: 2 }\nexport const nothing: number = 1` })).toBe("compiled")
    })

    it("refuses what the runner forbids: the host, the module system, dynamic import, import.meta and a syntax error", () => {
        expect(refusal({ "run.ts": `function run() { return process.env.X }` })).toBe("run.ts: `process` is not available to a cell source")
        expect(refusal({ "run.ts": `function run() { return require("fs") }` })).toBe("run.ts: `require` is not available to a cell source")
        expect(refusal({ "run.ts": `function run() { return eval("1") }` })).toBe("run.ts: `eval` is not available to a cell source")
        expect(refusal({ "run.ts": `function run() { return globalThis }` })).toBe("run.ts: `globalThis` is not available to a cell source")
        expect(refusal({ "run.ts": `function run() { return import("x") }` })).toBe("run.ts: dynamic import is not allowed in a cell source")
        expect(refusal({ "run.ts": `function run() { return import.meta }` })).toBe("run.ts: `import.meta` is not allowed in a cell source")
        expect(refusal({ "run.ts": `function run( {` })).toContain("run.ts: ")
        expect(refusal({ "run.ts": `function run( {` })).not.toBe("compiled")
    })

    it("allows the names of members that only look like host names", () => {
        expect(refusal({ "run.ts": `function run(input) { return { process: input.process, window: input.window } }` })).toBe("compiled")
    })
})

describe("builders", () => {
    it("ref keeps its default and round only when given", () => {
        expect(ref("trigger.a")).toEqual({ $ref: "trigger.a" })
        expect(ref("steps.a.output.b", { default: 0, round: "previous" })).toEqual({ $ref: "steps.a.output.b", default: 0, round: "previous" })
    })

    it("when builds the stored expression shapes", () => {
        const a = ref("vars.a")
        expect(when.present(a)).toEqual({ op: "present", ref: a })
        expect(when.absent(a)).toEqual({ op: "absent", ref: a })
        expect(when.eq(a, 1)).toEqual({ op: "eq", ref: a, value: 1 })
        expect(when.ne(a, 1)).toEqual({ op: "ne", ref: a, value: 1 })
        expect(when.gt(a, 1)).toEqual({ op: "gt", ref: a, value: 1 })
        expect(when.gte(a, 1)).toEqual({ op: "gte", ref: a, value: 1 })
        expect(when.lt(a, 1)).toEqual({ op: "lt", ref: a, value: 1 })
        expect(when.lte(a, 1)).toEqual({ op: "lte", ref: a, value: 1 })
        expect(when.contains(a, "x")).toEqual({ op: "contains", ref: a, value: "x" })
        expect(when.contains(a, "x", { caseFold: true })).toEqual({ op: "contains", ref: a, value: "x", caseFold: true })
        expect(when.and(when.present(a), when.not(when.absent(a)))).toEqual({ and: [{ op: "present", ref: a }, { not: { op: "absent", ref: a } }] })
        expect(when.or(when.present(a))).toEqual({ or: [{ op: "present", ref: a }] })
    })

    it("steps carry their kind, with defaults for a node", () => {
        expect(node({ key: "demo.a", version: 2 })).toEqual({ kind: "node", cell: { kind: "node", key: "demo.a", version: 2 }, input: {}, mode: "auto", accounts: [] })
        expect(
            node({ key: "demo.a", version: 2 }, { input: { x: 1 }, mode: "ask", accounts: ["sepay"], next: "b", routes: { yes: "b" }, unsuccessful: { reason: "x" } }),
        ).toEqual({
            kind: "node",
            cell: { kind: "node", key: "demo.a", version: 2 },
            input: { x: 1 },
            mode: "ask",
            accounts: ["sepay"],
            next: "b",
            routes: { yes: "b" },
            unsuccessful: { reason: "x" },
        })
        const test = when.present(ref("vars.a"))
        expect(ifNode({ when: test, yes: "a" })).toEqual({ kind: "core.if", when: test, yes: "a" })
        expect(ifNode({ when: test, yes: "a", no: "b", label: { vi: "v", en: "e" } })).toEqual({ kind: "core.if", when: test, yes: "a", no: "b", label: { vi: "v", en: "e" } })
        expect(loop({ max: 3 })).toEqual({ kind: "core.loop", config: { max: 3 } })
        expect(wait({ keys: [] })).toEqual({ kind: "core.wait", config: { keys: [] } })
        expect(handBack({ wait: "w" })).toEqual({ kind: "core.hand-back", config: { wait: "w" } })
        expect(call({ graph: "g" })).toEqual({ kind: "core.call-workflow", config: { graph: "g" } })
        expect(outcome({ name: "done" })).toEqual({ kind: "core.outcome", config: { name: "done" } })
        expect(set({ a: 1 })).toEqual({ kind: "core.set", config: { set: { a: 1 } } })
        expect(set({ a: 1 }, { next: "b" })).toEqual({ kind: "core.set", config: { set: { a: 1 }, next: "b" } })
    })

    it("graph, cellFile, packageFile and project keep what they are given", () => {
        expect(graph({ key: "g", version: 1, start: "a", steps: {} })).toEqual({ key: "g", version: 1, start: "a", triggers: [], steps: {} })
        expect(
            graph({ key: "g", version: 1, start: "a", triggers: [{ verb: "v" }], steps: {}, vars: { x: { schema: { type: "number" }, merge: "append" } }, reviewState: "draft" }),
        ).toEqual({ key: "g", version: 1, start: "a", triggers: [{ verb: "v" }], steps: {}, vars: { x: { schema: { type: "number" }, merge: "append" } }, reviewState: "draft" })
        const cell: CellFileData = { kind: "tool", key: "k", version: 1, title: { vi: "v", en: "e" }, input: {}, output: {}, semantics: { mutates: false } }
        const pack = { key: "p", version: "1.0.0", visibility: "public", author: "a" } as const
        expect(cellFile(cell)).toBe(cell)
        expect(packageFile(pack)).toBe(pack)
        const whole: AuthorProject = { package: pack, cells: [cell], graphs: [] }
        expect(project(whole)).toBe(whole)
    })
})

describe("yamlOf", () => {
    it("sorts keys at every level, folds nothing and ends with one newline", () => {
        const long = "x".repeat(200)
        expect(yamlOf({ b: 1, a: { d: [1, 2], c: long } })).toBe(`a:\n  c: ${long}\n  d:\n    - 1\n    - 2\nb: 1\n`)
        expect(yamlOf({ b: 1, a: 2 })).toBe(yamlOf({ a: 2, b: 1 }))
        expect(yamlOf({ a: undefined, b: 1 })).toBe("b: 1\n")
    })
})

describe("emitProject and diffFiles", () => {
    const cell = (overrides: Partial<CellFileData> = {}): CellFileData => ({
        kind: "node",
        key: "demo.n",
        version: 1,
        title: { vi: "v", en: "e" },
        input: { type: "object" },
        output: { type: "object" },
        semantics: { mutates: false },
        source: "run.js",
        origin: "run.ts",
        ...overrides,
    })
    const pack = packageFile({ key: "p", version: "1.0.0", visibility: "public", author: "a" })
    const files = { "cells/node/demo.n/v1/run.ts": "export function run(input: unknown) { return input }" }

    it("emits the package file, the data file, the compiled source and the graph files, sorted by path", () => {
        const emitted = emitProject({ package: pack, cells: [cell()], graphs: [graph({ key: "g", version: 3, start: "a", steps: { a: outcome({ name: "ok" }) } })] }, readerOf(files))
        expect(emitted.map((file) => file.path)).toEqual(["cells.package.yaml", "cells/node/demo.n/v1/cell.yaml", "cells/node/demo.n/v1/run.js", "graphs/g/v3/graph.yaml"])
        expect(emitted[2]?.text).toBe("function run(input) { return input; }\n")
        expect(emitted[1]?.text).toBe(
            "input:\n  type: object\nkey: demo.n\nkind: node\norigin: run.ts\noutput:\n  type: object\nsemantics:\n  mutates: false\nsource: run.js\ntitle:\n  en: e\n  vi: v\nversion: 1\n",
        )
    })

    it("emits a cell without a source as its data file only", () => {
        const emitted = emitProject({ package: pack, cells: [cell({ source: undefined, origin: undefined })], graphs: [] }, readerOf({}))
        expect(emitted.map((file) => file.path)).toEqual(["cells.package.yaml", "cells/node/demo.n/v1/cell.yaml"])
    })

    it("refuses a source that is not a .js name and an origin that is not its .ts", () => {
        expect(() => emitProject({ package: pack, cells: [cell({ source: "run.txt" })], graphs: [] }, readerOf(files))).toThrow(
            'cells/node/demo.n/v1/cell.yaml: source "run.txt" must be a .js file name (compiled from its .ts origin)',
        )
        expect(() => emitProject({ package: pack, cells: [cell({ origin: "other.ts" })], graphs: [] }, readerOf(files))).toThrow(
            'cells/node/demo.n/v1/cell.yaml: origin must be "run.ts" for source "run.js"',
        )
        expect(originOf("translate.js")).toBe("translate.ts")
    })

    it("reports a missing file and the first differing character, and nothing for an equal one", () => {
        const emitted = [
            { path: "a.yaml", text: "abc\n" },
            { path: "b.yaml", text: "abc\n" },
            { path: "c.yaml", text: "abc\n" },
            { path: "d.yaml", text: "abc\n" },
        ]
        const disk = readerOf({ "a.yaml": "abc\n", "b.yaml": "abd\n", "c.yaml": "ab" })
        expect(diffFiles(emitted, disk)).toEqual([
            { path: "b.yaml", reason: "differs", at: 2 },
            { path: "c.yaml", reason: "differs", at: 2 },
            { path: "d.yaml", reason: "missing", at: null },
        ])
    })
})

describe.each([
    ["demo-money", demoMoney],
    ["demo-crm-lead", demoCrmLead],
])("the fixture package %s", (name, authored) => {
    const root = join(FIXTURES, name)
    const emitted = emitProject(authored, diskOf(root))

    it("emits the same data as the stored yaml files, parsed", () => {
        for (const file of emitted.filter((entry) => entry.path.endsWith(".yaml"))) {
            const kept = diskOf(root)(file.path)
            expect({ path: file.path, data: parse(file.text) }).toEqual({ path: file.path, data: parse(kept ?? "") })
        }
    })

    it("compiles every .ts origin to the stored .js, ignoring layout", () => {
        const flat = (text: string): string => text.replace(/[\s;]+/gu, "")
        for (const file of emitted.filter((entry) => entry.path.endsWith(".js"))) {
            expect({ path: file.path, flat: flat(file.text) }).toEqual({ path: file.path, flat: flat(diskOf(root)(file.path) ?? "") })
        }
    })

    it("is byte for byte what is on disk (emit --check is green)", () => {
        expect(diffFiles(emitted, diskOf(root))).toEqual([])
    })

    it("is red on a one-byte change of a stored file", () => {
        const [first] = emitted
        const changed = (path: string): string | null => (path === first?.path ? `${diskOf(root)(path) ?? ""}x` : diskOf(root)(path))
        expect(diffFiles(emitted, changed).map((diff) => diff.path)).toEqual([first?.path])
    })
})
