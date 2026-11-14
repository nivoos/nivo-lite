import { scanSource } from "./cell-source-scan.policy"

describe("scanSource", () => {
    it("finds the tools called by literal name, the functions declared and no forbidden construct in a plain script", () => {
        const scan = scanSource('function run(input, ctx) {\n  const a = ctx.tool("one", {})\n  ctx.tool(`two`, {})\n  ctx.tool(name, {})\n  return a\n}\n')

        expect(scan.toolCalls).toEqual(["one", "two"])
        expect(scan.dynamicToolCalls).toBe(1)
        expect(scan.functions).toEqual(["run"])
        expect(scan.forbidden).toEqual([])
        expect(scan.syntax).toEqual([])
    })

    it.each([
        ['import x from "y"', ["import"]],
        ['import "y"', ["import"]],
        ['import fs = require("fs")', ["import"]],
        ["export function f() {}", ["export"]],
        ["export default 1", ["export"]],
        ['export { a } from "b"', ["export"]],
        ['const a = require("fs")', ["require"]],
        ['const a = import("x")', ["import"]],
        ["const a = import.meta", ["import"]],
        ['eval("1")', ["eval"]],
        ['Function("return 1")', ["Function"]],
        ['new Function("return 1")', ["Function"]],
    ])("refuses %s", (text, found) => {
        expect(scanSource(text).forbidden).toEqual(found)
    })

    it("does not take a word in a string, a comment, a property or a method as a use", () => {
        const scan = scanSource('// import x\nconst s = "require(a) eval(b)"\nconst o = { import: 1, export: 2 }\no.require("x")\no.eval(1)\n')

        expect(scan.forbidden).toEqual([])
    })

    it("reports the syntax errors the parser finds", () => {
        expect(scanSource("function run(((((").syntax.length).toBeGreaterThan(0)
    })
})
