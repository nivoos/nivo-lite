import { Test } from "@nestjs/testing"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import {
    ASK_TO_PAY_SOURCE,
    FILE_LEAD_SOURCE,
    MemoryCellsManager,
    askToPayNode,
    fileLeadNode,
    leadIntakeGraph,
    packageSourceOf,
    paymentGraph,
    paymentReadTool,
    sourceHashOf,
} from "@tests/fixtures/builders/cells-storage.builder"
import { CellDefinitionsService } from "./cell-definitions.service"
import { CELL_CACHE_LIMITS, CellReaderService } from "./cell-reader.service"
import type { CellListFilter } from "./cells.contracts"
import { CellsError, CellsErrorCode } from "./errors/cells.error"
import { CellDefinitionEntity, CellGraphEntity, CellPackageEntity, CellSourceEntity } from "./persistence/entities"

const ORIGIN = { repository: "git@example/demo", commit: "aaaa" }

/** The writer and the reader over the same memory rows, with the two fixture packages and both fixture node rows written. */
const build = async () => {
    const memory = new MemoryCellsManager()
    const moduleRef = await Test.createTestingModule({
        providers: [CellDefinitionsService, CellReaderService, { provide: PRIMARY_ENTITY_MANAGER, useValue: memory.manager() }],
    }).compile()
    const writer = moduleRef.get(CellDefinitionsService)
    const reader = moduleRef.get(CellReaderService)
    const manager = memory.manager()
    const money = await writer.putPackage(manager, { key: "demo-money", version: "1.0.0", visibility: "public", author: "nivo" }, ORIGIN)
    const lead = await writer.putPackage(
        manager,
        { key: "demo-crm-lead", version: "1.0.0", visibility: "private", enterprises: ["acme"], author: "acme" },
        ORIGIN,
    )
    const askSource = { id: await writer.putSource(manager, packageSourceOf(ASK_TO_PAY_SOURCE)), sha256: sourceHashOf(ASK_TO_PAY_SOURCE) }
    const fileSource = { id: await writer.putSource(manager, packageSourceOf(FILE_LEAD_SOURCE)), sha256: sourceHashOf(FILE_LEAD_SOURCE) }
    await writer.putDefinition(manager, money, askToPayNode(askSource))
    await writer.putDefinition(manager, lead, fileLeadNode(fileSource))
    await writer.putGraph(manager, lead, leadIntakeGraph())
    await writer.putGraph(manager, money, paymentGraph())
    return { memory, manager, writer, reader, money, lead }
}

const ASK = { kind: "node" as const, key: "demo.ask-to-pay", version: 1 }
const FILE = { kind: "node" as const, key: "demo.file-lead", version: 1 }
const INTAKE = { key: "demo.lead-intake", version: 1 }

const refusalOf = async (call: Promise<unknown>): Promise<CellsErrorCode | "resolved"> =>
    call.then(
        () => "resolved" as const,
        (error: unknown) => (error instanceof CellsError ? error.code : "resolved"),
    )

describe("CellReaderService round trip", () => {
    it("reads back the demo-money node row exactly as written", async () => {
        const { reader } = await build()
        const view = await reader.definition(ASK)
        expect(view).toEqual(
            expect.objectContaining({
                kind: "node",
                key: "demo.ask-to-pay",
                version: 1,
                packageKey: "demo-money",
                title: { vi: "Yeu cau thanh toan", en: "Ask to pay" },
                semantics: askToPayNode({ id: "x", sha256: "y" }).semantics,
                body: { entry: "run" },
                sourceSha256: sourceHashOf(ASK_TO_PAY_SOURCE),
                reviewState: "approved",
                deleted: false,
            }),
        )
        expect(view.examples).toEqual(askToPayNode({ id: "x", sha256: "y" }).examples)
        await expect(reader.source(sourceHashOf(ASK_TO_PAY_SOURCE))).resolves.toEqual({
            sha256: sourceHashOf(ASK_TO_PAY_SOURCE),
            language: "js-quickjs@1",
            text: ASK_TO_PAY_SOURCE,
        })
    })

    it("reads back the demo-crm-lead graph row with its vars declaration", async () => {
        const { reader } = await build()
        const view = await reader.graph(INTAKE)
        expect(view.document).toEqual(leadIntakeGraph().document)
        expect(view.document.vars).toEqual({ filed: { schema: { type: "object" } }, leads: { schema: { type: "array" }, merge: "append" } })
        expect(view).toEqual(expect.objectContaining({ key: "demo.lead-intake", version: 1, deleted: false }))
        expect(view.documentHash).toMatch(/^[0-9a-f]{64}$/)
    })

    it("reads a sourceless cell with a null sha256", async () => {
        const { reader, writer, manager, money } = await build()
        await writer.putDefinition(manager, money, paymentReadTool())
        await expect(reader.definition({ kind: "tool", key: "nivo.tool.payment.request.read", version: 1 })).resolves.toEqual(
            expect.objectContaining({ sourceSha256: null }),
        )
    })

    it("answers CELLS_UNKNOWN for a cell, a graph and a source that do not exist", async () => {
        const { reader } = await build()
        const codes = await Promise.all([
            refusalOf(reader.definition({ ...ASK, version: 9 })),
            refusalOf(reader.graph({ key: "demo.lead-intake", version: 9 })),
            refusalOf(reader.source("0".repeat(64))),
        ])
        expect(codes).toEqual([CellsErrorCode.Unknown, CellsErrorCode.Unknown, CellsErrorCode.Unknown])
    })
})

describe("CellReaderService cache", () => {
    it("answers a repeated read from the cache without reaching the rows", async () => {
        const { reader, memory } = await build()
        await reader.definition(ASK)
        await reader.graph(INTAKE)
        await reader.source(sourceHashOf(ASK_TO_PAY_SOURCE))
        const before = { ...memory.reads }
        await reader.definition(ASK)
        await reader.graph(INTAKE)
        await reader.source(sourceHashOf(ASK_TO_PAY_SOURCE))
        expect(memory.reads).toEqual(before)
    })

    it("reads the rows again after an invalidation, and sees the flags that moved", async () => {
        const { reader, writer, memory, manager } = await build()
        await reader.definition(ASK)
        await reader.graph(INTAKE)
        await writer.retire(manager, ASK)
        await writer.softDeleteGraph(manager, INTAKE)
        await expect(reader.definition(ASK)).resolves.toEqual(expect.objectContaining({ reviewState: "approved" }))
        reader.invalidate(ASK)
        reader.invalidateGraph(INTAKE)
        await expect(reader.definition(ASK)).resolves.toEqual(expect.objectContaining({ reviewState: "retired" }))
        await expect(reader.graph(INTAKE)).resolves.toEqual(expect.objectContaining({ deleted: true }))
        expect(memory.reads.CellDefinitionEntity).toBeGreaterThanOrEqual(3)
    })

    it("keeps at most 2,000 definitions, 500 graphs and 500 sources, dropping the least recently used", async () => {
        const { reader, writer, manager, money, memory } = await build()
        const total = CELL_CACHE_LIMITS.definitions + 1
        await Promise.all(
            Array.from({ length: total }, (_unused, index) =>
                writer.putDefinition(manager, money, { ...paymentReadTool(), key: `bulk.${String(index)}` }),
            ),
        )
        await Promise.all(
            Array.from({ length: CELL_CACHE_LIMITS.graphs + 1 }, (_unused, index) =>
                writer.putGraph(manager, money, { ...paymentGraph(), key: `bulk.${String(index)}` }),
            ),
        )
        const sources = await Promise.all(
            Array.from({ length: CELL_CACHE_LIMITS.sources + 1 }, (_unused, index) =>
                writer.putSource(manager, packageSourceOf(`// ${String(index)}`)).then(() => sourceHashOf(`// ${String(index)}`)),
            ),
        )
        const cell = (index: number) => ({ kind: "tool" as const, key: `bulk.${String(index)}`, version: 1 })
        await Promise.all(Array.from({ length: total }, (_unused, index) => reader.definition(cell(index))))
        await Promise.all(Array.from({ length: CELL_CACHE_LIMITS.graphs + 1 }, (_unused, index) => reader.graph({ key: `bulk.${String(index)}`, version: 1 })))
        await Promise.all(sources.map((sha256) => reader.source(sha256)))
        const before = { ...memory.reads }
        await reader.definition(cell(total - 1))
        await reader.graph({ key: `bulk.${String(CELL_CACHE_LIMITS.graphs)}`, version: 1 })
        await reader.source(sources[sources.length - 1] ?? "")
        expect(memory.reads).toEqual(before)
        await reader.definition(cell(0))
        await reader.graph({ key: "bulk.0", version: 1 })
        await reader.source(sources[0] ?? "")
        expect(memory.reads.CellDefinitionEntity).toBe((before.CellDefinitionEntity ?? 0) + 1)
        expect(memory.reads.CellGraphEntity).toBe((before.CellGraphEntity ?? 0) + 1)
        expect(memory.reads.CellSourceEntity).toBe((before.CellSourceEntity ?? 0) + 1)
    })
})

describe("CellReaderService changed rows", () => {
    it("refuses, and does not cache, a definition whose content no longer matches its hash", async () => {
        const { reader, memory } = await build()
        const row = memory.rowsOf(CellDefinitionEntity).find((candidate) => candidate.key === "demo.ask-to-pay")
        if (row === undefined) throw new Error("fixture row missing")
        row.body = { entry: "other" }
        await expect(refusalOf(reader.definition(ASK))).resolves.toBe(CellsErrorCode.VersionImmutable)
        row.body = { entry: "run" }
        await expect(reader.definition(ASK)).resolves.toEqual(expect.objectContaining({ body: { entry: "run" } }))
    })

    it("refuses a graph whose document no longer matches its hash", async () => {
        const { reader, memory } = await build()
        const row = memory.rowsOf(CellGraphEntity).find((candidate) => candidate.key === "demo.lead-intake")
        if (row === undefined) throw new Error("fixture row missing")
        row.document = { ...leadIntakeGraph().document, vars: {} }
        await expect(refusalOf(reader.graph(INTAKE))).resolves.toBe(CellsErrorCode.VersionImmutable)
    })

    it("refuses a source whose text no longer hashes to its sha256", async () => {
        const { reader, memory } = await build()
        const row = memory.rowsOf(CellSourceEntity)[0]
        if (row === undefined) throw new Error("fixture row missing")
        row.text = "tampered"
        await expect(refusalOf(reader.source(sourceHashOf(ASK_TO_PAY_SOURCE)))).resolves.toBe(CellsErrorCode.SourceHashMismatch)
    })
})

describe("CellReaderService soft delete", () => {
    it("still reads a soft-deleted version by its exact ref, marked deleted", async () => {
        const { reader, writer, manager } = await build()
        await writer.softDelete(manager, FILE)
        await writer.softDeleteGraph(manager, INTAKE)
        await expect(reader.definition(FILE)).resolves.toEqual(expect.objectContaining({ deleted: true, reviewState: "approved" }))
        await expect(reader.graph(INTAKE)).resolves.toEqual(expect.objectContaining({ deleted: true }))
    })
})

describe("CellReaderService listed", () => {
    const rowsOf = [{ kind: "node", key: "demo.ask-to-pay", version: 1 }]

    it("asks for approved, not deleted cells of a package that is not deleted, and answers refs", async () => {
        const { reader, memory } = await build()
        memory.queueBuilder({ getMany: rowsOf })
        await expect(reader.listed({ enterprise: null })).resolves.toEqual([{ kind: "node", key: "demo.ask-to-pay", version: 1 }])
        const builder = memory.builders[0]
        expect(builder?.callsOf("where")).toEqual([["d.review_state = 'approved'"]])
        expect(builder?.callsOf("andWhere")).toEqual([["d.deleted_at IS NULL"], ["p.deleted_at IS NULL"], ["p.visibility = 'public'"]])
        expect(builder?.callsOf("orderBy")).toEqual([["d.kind"]])
    })

    it("limits a signed-in enterprise to public packages and its own private ones, and a named kind to that kind", async () => {
        const { reader, memory } = await build()
        const filter: CellListFilter = { kind: "node", enterprise: "acme" }
        memory.queueBuilder({ getMany: [] })
        await expect(reader.listed(filter)).resolves.toEqual([])
        expect(memory.builders[0]?.callsOf("andWhere")).toEqual([
            ["d.deleted_at IS NULL"],
            ["p.deleted_at IS NULL"],
            ["d.kind = :kind", { kind: "node" }],
            ["(p.visibility = 'public' OR :enterprise = ANY(p.enterprises))", { enterprise: "acme" }],
        ])
    })

    it("joins the package entity, not a dotted table", async () => {
        const { reader, memory } = await build()
        memory.queueBuilder({ getMany: [] })
        await reader.listed({ enterprise: "acme" })
        expect(memory.builders[0]?.callsOf("innerJoin")).toEqual([[CellPackageEntity, "p", "p.id = d.package_id"]])
    })
})
