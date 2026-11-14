import { Test } from "@nestjs/testing"
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
import { definitionHashOf, documentHashOf } from "./cell-hash.policy"
import type { CellPackageFile } from "./cells.contracts"
import { CellsError, CellsErrorCode } from "./errors/cells.error"
import {
    CellDefinitionEntity,
    CellGraphEntity,
    CellPackageEntity,
    CellSeedReceiptEntity,
    CellSourceEntity,
} from "./persistence/entities"

const PUBLIC_PACKAGE: CellPackageFile = { key: "demo-money", version: "1.0.0", visibility: "public", author: "nivo" }
const PRIVATE_PACKAGE: CellPackageFile = {
    key: "demo-crm-lead",
    version: "1.0.0",
    visibility: "private",
    enterprises: ["acme"],
    author: "acme",
}
const ORIGIN = { repository: "git@example/demo-money", commit: "aaaa" }

const build = async () => {
    const moduleRef = await Test.createTestingModule({ providers: [CellDefinitionsService] }).compile()
    const memory = new MemoryCellsManager()
    return { service: moduleRef.get(CellDefinitionsService), memory, manager: memory.manager() }
}

const refusalOf = async (call: Promise<unknown>): Promise<CellsErrorCode | "resolved"> =>
    call.then(
        () => "resolved" as const,
        (error: unknown) => (error instanceof CellsError ? error.code : "resolved"),
    )

describe("CellDefinitionsService putPackage", () => {
    it("inserts a package version once and answers the same id for the same content", async () => {
        const { service, memory, manager } = await build()
        const first = await service.putPackage(manager, PUBLIC_PACKAGE, ORIGIN)
        const again = await service.putPackage(manager, PUBLIC_PACKAGE, { repository: "other", commit: "bbbb" })
        expect(again).toBe(first)
        expect(memory.rowsOf(CellPackageEntity)).toEqual([
            expect.objectContaining({ key: "demo-money", version: "1.0.0", visibility: "public", enterprises: [], repository: ORIGIN.repository }),
        ])
    })

    it("keeps the enterprises of a private package", async () => {
        const { service, memory, manager } = await build()
        await service.putPackage(manager, PRIVATE_PACKAGE, ORIGIN)
        expect(memory.rowsOf(CellPackageEntity)).toEqual([expect.objectContaining({ visibility: "private", enterprises: ["acme"] })])
    })

    it.each([
        ["visibility", { ...PRIVATE_PACKAGE, visibility: "public" as const }],
        ["author", { ...PRIVATE_PACKAGE, author: "someone" }],
        ["enterprise list", { ...PRIVATE_PACKAGE, enterprises: ["acme", "beta"] }],
        ["enterprise", { ...PRIVATE_PACKAGE, enterprises: ["beta"] }],
    ])("refuses the same package version with another %s", async (_name, other) => {
        const { service, manager } = await build()
        await service.putPackage(manager, PRIVATE_PACKAGE, ORIGIN)
        await expect(refusalOf(service.putPackage(manager, other, ORIGIN))).resolves.toBe(CellsErrorCode.VersionImmutable)
    })
})

describe("CellDefinitionsService putSource", () => {
    it("stores a text once by its sha256 and answers the same id again", async () => {
        const { service, memory, manager } = await build()
        const id = await service.putSource(manager, packageSourceOf(ASK_TO_PAY_SOURCE))
        await expect(service.putSource(manager, packageSourceOf(ASK_TO_PAY_SOURCE))).resolves.toBe(id)
        expect(memory.rowsOf(CellSourceEntity)).toEqual([
            expect.objectContaining({
                sha256: sourceHashOf(ASK_TO_PAY_SOURCE),
                language: "js-quickjs@1",
                bytes: Buffer.byteLength(ASK_TO_PAY_SOURCE, "utf8"),
                authorKind: "package",
                authorRef: "demo-pkg",
            }),
        ])
    })
})

describe("CellDefinitionsService putDefinition", () => {
    it("writes the node row of demo-money with its source pair, its hash and a publish time", async () => {
        const { service, memory, manager } = await build()
        const packageId = await service.putPackage(manager, PUBLIC_PACKAGE, ORIGIN)
        const sourceId = await service.putSource(manager, packageSourceOf(ASK_TO_PAY_SOURCE))
        const node = askToPayNode({ id: sourceId, sha256: sourceHashOf(ASK_TO_PAY_SOURCE) })
        await expect(service.putDefinition(manager, packageId, node)).resolves.toBe("created")
        expect(memory.rowsOf(CellDefinitionEntity)).toEqual([
            expect.objectContaining({
                packageId,
                kind: "node",
                key: "demo.ask-to-pay",
                version: 1,
                sourceId,
                sourceSha256: sourceHashOf(ASK_TO_PAY_SOURCE),
                definitionHash: definitionHashOf({ ...node, sourceSha256: sourceHashOf(ASK_TO_PAY_SOURCE) }),
                reviewState: "approved",
                reviewRef: "demo-money@aaaa",
                publishedAt: expect.any(Date),
            }),
        ])
    })

    it("answers unchanged for the same content, even from a later package version", async () => {
        const { service, memory, manager } = await build()
        const packageId = await service.putPackage(manager, PUBLIC_PACKAGE, ORIGIN)
        const laterId = await service.putPackage(manager, { ...PUBLIC_PACKAGE, version: "1.1.0" }, ORIGIN)
        const source = { id: await service.putSource(manager, packageSourceOf(FILE_LEAD_SOURCE)), sha256: sourceHashOf(FILE_LEAD_SOURCE) }
        await service.putDefinition(manager, packageId, fileLeadNode(source))
        await expect(service.putDefinition(manager, laterId, fileLeadNode(source))).resolves.toBe("unchanged")
        expect(memory.rowsOf(CellDefinitionEntity)).toHaveLength(1)
    })

    it("refuses other content for a kept (kind, key, version) with CELLS_VERSION_IMMUTABLE", async () => {
        const { service, manager } = await build()
        const packageId = await service.putPackage(manager, PUBLIC_PACKAGE, ORIGIN)
        const source = { id: await service.putSource(manager, packageSourceOf(FILE_LEAD_SOURCE)), sha256: sourceHashOf(FILE_LEAD_SOURCE) }
        await service.putDefinition(manager, packageId, fileLeadNode(source))
        const changed = { ...fileLeadNode(source), semantics: { mutates: false } }
        await expect(refusalOf(service.putDefinition(manager, packageId, changed))).resolves.toBe(CellsErrorCode.VersionImmutable)
    })

    it("writes a sourceless draft row with no publish time", async () => {
        const { service, memory, manager } = await build()
        const packageId = await service.putPackage(manager, PUBLIC_PACKAGE, ORIGIN)
        await service.putDefinition(manager, packageId, { ...paymentReadTool(), reviewState: "draft", reviewRef: null })
        expect(memory.rowsOf(CellDefinitionEntity)).toEqual([
            expect.objectContaining({ sourceId: null, sourceSha256: null, reviewState: "draft", publishedAt: null }),
        ])
    })
})

describe("CellDefinitionsService putGraph", () => {
    it("writes the graph row of demo-crm-lead with its vars declaration and its trigger list", async () => {
        const { service, memory, manager } = await build()
        const packageId = await service.putPackage(manager, PRIVATE_PACKAGE, ORIGIN)
        const graph = leadIntakeGraph()
        await expect(service.putGraph(manager, packageId, graph)).resolves.toBe("created")
        expect(memory.rowsOf(CellGraphEntity)).toEqual([
            expect.objectContaining({
                packageId,
                key: "demo.lead-intake",
                version: 1,
                document: graph.document,
                triggers: graph.document.triggers,
                documentHash: documentHashOf(graph.document),
                reviewState: "approved",
                publishedAt: expect.any(Date),
            }),
        ])
    })

    it("answers unchanged for the same document and refuses a changed one", async () => {
        const { service, manager } = await build()
        const packageId = await service.putPackage(manager, PUBLIC_PACKAGE, ORIGIN)
        await service.putGraph(manager, packageId, paymentGraph())
        await expect(service.putGraph(manager, packageId, paymentGraph())).resolves.toBe("unchanged")
        const changed = { ...paymentGraph(), document: { ...paymentGraph().document, start: "ask" } }
        await expect(refusalOf(service.putGraph(manager, packageId, changed))).resolves.toBe(CellsErrorCode.VersionImmutable)
    })

    it("refuses a changed vars declaration", async () => {
        const { service, manager } = await build()
        const packageId = await service.putPackage(manager, PRIVATE_PACKAGE, ORIGIN)
        await service.putGraph(manager, packageId, leadIntakeGraph())
        const document = { ...leadIntakeGraph().document, vars: { filed: { schema: { type: "string" } } } }
        await expect(refusalOf(service.putGraph(manager, packageId, { ...leadIntakeGraph(), document }))).resolves.toBe(CellsErrorCode.VersionImmutable)
    })

    it("writes a draft graph with no publish time", async () => {
        const { service, memory, manager } = await build()
        const packageId = await service.putPackage(manager, PUBLIC_PACKAGE, ORIGIN)
        await service.putGraph(manager, packageId, { ...paymentGraph(), reviewState: "draft", reviewRef: null })
        expect(memory.rowsOf(CellGraphEntity)).toEqual([expect.objectContaining({ reviewState: "draft", publishedAt: null })])
    })
})

describe("CellDefinitionsService retire and soft delete", () => {
    const seeded = async () => {
        const built = await build()
        const packageId = await built.service.putPackage(built.manager, PUBLIC_PACKAGE, ORIGIN)
        await built.service.putDefinition(built.manager, packageId, paymentReadTool())
        await built.service.putGraph(built.manager, packageId, paymentGraph())
        return built
    }
    const READ = { kind: "tool" as const, key: "nivo.tool.payment.request.read", version: 1 }

    it("retires a version, and retiring it again changes nothing", async () => {
        const { service, memory, manager } = await seeded()
        await service.retire(manager, READ)
        expect(memory.rowsOf(CellDefinitionEntity)[0]).toEqual(expect.objectContaining({ reviewState: "retired" }))
        const reads = memory.reads.CellDefinitionEntity
        await service.retire(manager, READ)
        expect(memory.reads.CellDefinitionEntity).toBe((reads ?? 0) + 1)
    })

    it("retires a graph version", async () => {
        const { service, memory, manager } = await seeded()
        await service.retireGraph(manager, { key: "demo.payment", version: 1 })
        await service.retireGraph(manager, { key: "demo.payment", version: 1 })
        expect(memory.rowsOf(CellGraphEntity)[0]).toEqual(expect.objectContaining({ reviewState: "retired" }))
    })

    it("soft-deletes a version, a graph and a package (twice is the same)", async () => {
        const { service, memory, manager } = await seeded()
        await service.softDelete(manager, READ)
        await service.softDelete(manager, READ)
        await service.softDeleteGraph(manager, { key: "demo.payment", version: 1 })
        await service.softDeleteGraph(manager, { key: "demo.payment", version: 1 })
        await service.softDeletePackage(manager, "demo-money", "1.0.0")
        await service.softDeletePackage(manager, "demo-money", "1.0.0")
        expect([CellDefinitionEntity, CellGraphEntity, CellPackageEntity].map((entity) => memory.rowsOf(entity)[0]?.deletedAt)).toEqual([
            expect.any(Date),
            expect.any(Date),
            expect.any(Date),
        ])
    })

    it("answers CELLS_UNKNOWN for a version, a graph or a package that does not exist", async () => {
        const { service, manager } = await build()
        const ref = { kind: "node" as const, key: "none", version: 1 }
        const graph = { key: "none", version: 1 }
        const codes = await Promise.all([
            refusalOf(service.retire(manager, ref)),
            refusalOf(service.softDelete(manager, ref)),
            refusalOf(service.retireGraph(manager, graph)),
            refusalOf(service.softDeleteGraph(manager, graph)),
            refusalOf(service.softDeletePackage(manager, "none", "1")),
        ])
        expect(codes).toEqual(Array.from({ length: 5 }, () => CellsErrorCode.Unknown))
    })
})

describe("CellDefinitionsService receipt", () => {
    const report = { created: ["node:demo.ask-to-pay@1"], unchanged: [], refused: [], notInPackage: [] }
    const receipt = { packageKey: "demo-money", repository: ORIGIN.repository, commit: "aaaa", forced: false, report }

    it("writes the receipt of a package commit once and keeps the first report", async () => {
        const { service, memory, manager } = await build()
        await service.receipt(manager, receipt)
        await service.receipt(manager, { ...receipt, report: { ...report, created: [] } })
        expect(memory.rowsOf(CellSeedReceiptEntity)).toEqual([expect.objectContaining({ packageKey: "demo-money", commit: "aaaa", forced: false, report })])
    })

    it("tells a plain apply from a forced one", async () => {
        const { service, manager } = await build()
        await service.receipt(manager, receipt)
        await expect(service.receiptExists(manager, "demo-money", "aaaa", false)).resolves.toBe(true)
        await expect(service.receiptExists(manager, "demo-money", "aaaa", true)).resolves.toBe(false)
        await service.receipt(manager, { ...receipt, forced: true })
        await expect(service.receiptExists(manager, "demo-money", "aaaa", true)).resolves.toBe(true)
    })
})
