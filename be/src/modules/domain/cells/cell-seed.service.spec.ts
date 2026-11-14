import { CellsErrorCode } from "@modules/domain/cells"
import { FIXTURE_PACKAGES, ORIGIN, buildSeed, edited, editedYaml, packageFiles, withoutFolder } from "@tests/fixtures/builders/cells-seed.builder"

const NEXT_COMMIT = "b".repeat(40)

const countOf = (lines: ReadonlyArray<string>, start: string): number => lines.filter((line) => line.startsWith(start)).length

const request = (files: Map<string, string>, more: { readonly force?: boolean; readonly dry?: boolean; readonly commit?: string } = {}) => ({
    files,
    origin: { repository: ORIGIN.repository, commit: more.commit ?? ORIGIN.commit },
    force: more.force ?? false,
    dry: more.dry ?? false,
})

describe("CellSeedService", () => {
    describe.each(FIXTURE_PACKAGES)("package %s", (name) => {
        it("seeds every cell and graph, writes the receipt, and a second apply of the commit is skipped whole", async () => {
            const { seed, writer } = await buildSeed()
            const files = packageFiles(name)

            const first = await seed.apply(request(files))
            const second = await seed.apply(request(files))

            expect(first.ready).toBe(true)
            expect(first.lines.at(-1)).toBe("applied")
            expect(countOf(first.lines, "created ")).toBe(writer.calls.filter((call) => call.method === "putDefinition" || call.method === "putGraph").length)
            expect(countOf(first.lines, "refused ")).toBe(0)
            expect(writer.receipts).toHaveLength(1)
            expect(writer.receipts[0]).toMatchObject({ packageKey: name, commit: ORIGIN.commit, forced: false })
            expect(second.lines.at(-1)).toBe("skipped")
            expect(writer.calls.filter((call) => call.method === "receipt")).toHaveLength(1)
        })

        it("re-applies at a new pin with every row unchanged", async () => {
            const { seed } = await buildSeed()
            const files = packageFiles(name)
            const first = await seed.apply(request(files))

            const again = await seed.apply(request(files, { commit: NEXT_COMMIT }))

            expect(again.lines.at(-1)).toBe("unchanged")
            expect(countOf(again.lines, "created ")).toBe(0)
            expect(countOf(again.lines, "unchanged ")).toBe(countOf(first.lines, "created "))
        })

        it("a declared force re-applies once per commit, every row unchanged", async () => {
            const { seed, writer } = await buildSeed()
            const files = packageFiles(name)
            await seed.apply(request(files))

            const forced = await seed.apply(request(files, { force: true }))
            const forcedAgain = await seed.apply(request(files, { force: true }))

            expect(forced.lines.at(-1)).toBe("unchanged")
            expect(countOf(forced.lines, "created ")).toBe(0)
            expect(writer.receipts.map((receipt) => receipt.forced)).toEqual([false, true])
            expect(forcedAgain.lines.at(-1)).toBe("skipped")
        })

        it("a dry run shows the creations, writes no receipt and rolls its transaction back", async () => {
            const { seed, writer, manager } = await buildSeed()

            const view = await seed.apply(request(packageFiles(name), { dry: true }))

            expect(view.lines.at(-1)).toBe("dry run: nothing written")
            expect(countOf(view.lines, "would create ")).toBeGreaterThan(0)
            expect(writer.receipts).toEqual([])
            expect(jest.mocked(manager.transaction).mock.calls.length).toBeGreaterThan(0)
        })

        it("a version removed from the package is reported, never deleted, and stays reported", async () => {
            const { seed, writer } = await buildSeed()
            await seed.apply(request(packageFiles(name)))
            const folder = name === "demo-money" ? "cells/core.outcome" : "cells/provider"
            const gone = name === "demo-money" ? "core.outcome:core.outcome@1" : "provider:demo.crm@1"

            const next = await seed.apply(request(withoutFolder(packageFiles(name), folder), { commit: NEXT_COMMIT }))
            const later = await seed.apply(request(withoutFolder(packageFiles(name), folder), { commit: "c".repeat(40) }))

            expect(next.lines).toContain(`no longer in the package: ${gone} (kept, never deleted)`)
            expect(later.lines).toContain(`no longer in the package: ${gone} (kept, never deleted)`)
            expect(writer.retired).toEqual([])
            expect(writer.calls.map((call) => call.method)).not.toContain("delete")
        })
    })

    it("demo-money: a cell with an import is refused with its code, the graph that needs it too, and the rest seeds", async () => {
        const { seed, writer } = await buildSeed()
        const files = edited(packageFiles("demo-money"), "cells/node/demo.ask-to-pay/v1/run.js", (text) => `import x from "y"\n${text}`)

        const view = await seed.apply(request(files))

        expect(view.ready).toBe(false)
        expect(view.lines.filter((line) => line.startsWith("refused "))).toEqual([
            expect.stringContaining(`node:demo.ask-to-pay@1 ${CellsErrorCode.SourceImports}`),
            expect.stringContaining(`graph:demo.payment@1 ${CellsErrorCode.GraphRefUnknown}`),
        ])
        expect(countOf(view.lines, "created ")).toBe(8)
        expect(writer.calls.filter((call) => call.method === "putDefinition").map((call) => call.key)).not.toContain("node:demo.ask-to-pay@1")
        expect(writer.receipts).toHaveLength(1)
    })

    it("demo-crm-lead: finalRefusals outside refusals is refused with its code, the node that names the tool too, and the rest seeds", async () => {
        const { seed } = await buildSeed()
        const files = editedYaml(packageFiles("demo-crm-lead"), "cells/tool/nivo.tool.crm.lead.create/v1/cell.yaml", (cell) => {
            cell.semantics.finalRefusals = ["nope"]
        })

        const view = await seed.apply(request(files))

        expect(view.lines.filter((line) => line.startsWith("refused ")).map((line) => line.split(" ").slice(1, 3).join(" "))).toEqual([
            `tool:nivo.tool.crm.lead.create@1 ${CellsErrorCode.SemanticsInvalid}`,
            `node:demo.file-lead@1 ${CellsErrorCode.SemanticsInvalid}`,
            `graph:demo.lead-intake@1 ${CellsErrorCode.GraphRefUnknown}`,
        ])
        expect(countOf(view.lines, "created ")).toBe(6)
    })

    it("a published version seeded again with other content is refused CELLS_VERSION_IMMUTABLE while the rest stays unchanged", async () => {
        const { seed } = await buildSeed()
        await seed.apply(request(packageFiles("demo-money")))
        const changed = editedYaml(packageFiles("demo-money"), "cells/tool/nivo.tool.customer.message.send/v1/cell.yaml", (cell) => {
            cell.title.vi = "Gửi tin nhắn"
        })

        const view = await seed.apply(request(changed, { commit: NEXT_COMMIT }))

        expect(view.lines.filter((line) => line.startsWith("refused "))).toEqual([expect.stringContaining(`tool:nivo.tool.customer.message.send@1 ${CellsErrorCode.VersionImmutable}`)])
        expect(countOf(view.lines, "unchanged ")).toBe(9)
        expect(view.ready).toBe(false)
    })

    it("a version whose file says retired is retired through the writer", async () => {
        const { seed, writer } = await buildSeed()
        const files = editedYaml(packageFiles("demo-money"), "cells/tool/nivo.tool.payment.request.read/v1/cell.yaml", (cell) => {
            cell.reviewState = "retired"
        })

        await seed.apply(request(files))

        expect(writer.retired).toEqual(["tool:nivo.tool.payment.request.read@1"])
    })

    it("the source row's author reference names the package, the commit and the origin file; the source is stored with its sha256", async () => {
        const { seed, writer } = await buildSeed()

        await seed.apply(request(packageFiles("demo-money")))

        expect(writer.calls.filter((call) => call.method === "putSource")).toHaveLength(2)
    })

    it("check prints READY with one line per cell and graph and writes nothing", async () => {
        const { seed, writer } = await buildSeed()

        const view = await seed.check(packageFiles("demo-money"))

        expect(view.lines[0]).toBe("demo-money@1.0.0")
        expect(view.lines.at(-1)).toBe("READY")
        expect(writer.calls).toEqual([])
    })

    it("check says NOT READY with the number of refusals", async () => {
        const { seed } = await buildSeed()
        const files = edited(packageFiles("demo-money"), "cells/node/demo.ask-to-pay/v1/run.js", (text) => `require("x")\n${text}`)

        const view = await seed.check(files)

        expect(view.ready).toBe(false)
        expect(view.lines.at(-1)).toBe("NOT READY: 2 refused")
    })
})
