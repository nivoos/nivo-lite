import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { eachInOrder } from "@modules/platform/primitives"
import { sha256Of } from "./cell-hash.policy"
import type { CellFile, CellPackageFile, CellPackageOrigin, JsonObject, SeedReport } from "./cells.contracts"
import { InjectCellDefinitionsWriter } from "./cells.decorators"
import type { CellDefinitionsWriter } from "./cell-definitions-writer.port"
import { CellsError, CellsErrorCode } from "./errors/cells.error"
import {
    cellRefText,
    graphRefText,
    readCellPackage,
    validatedCellOf,
    validatedGraphOf,
    type CellPackageFiles,
    type PackageCell,
    type PackageGraph,
} from "./cell-package-files.mapper"
import { CellValidationService } from "./cell-validation.service"
import { CellSeedReceiptEntity } from "./persistence/entities/cell-seed-receipt.entity"

/** What a seed run answers: whether every thing of the package is good, and the lines to print (the last is `applied`, `unchanged` or `skipped`). */
export interface CellSeedView {
    readonly ready: boolean
    readonly lines: ReadonlyArray<string>
}

/** What `apply` is asked to do. */
export interface CellSeedRequest {
    readonly files: CellPackageFiles
    readonly origin: CellPackageOrigin
    /** The stack's declared force: re-applies once per commit (seeds-and-data rule 9). */
    readonly force: boolean
    /** Runs every write for real and rolls it back, so the report is exact and nothing stays. */
    readonly dry: boolean
}

/** A thing the package holds that failed a check. */
type Refused = SeedReport["refused"][number]

/** The package after every check: what may be written, what was refused, and every name the package holds. */
interface Judged {
    readonly manifest: CellPackageFile
    readonly cells: ReadonlyArray<PackageCell>
    readonly graphs: ReadonlyArray<PackageGraph>
    readonly refused: ReadonlyArray<Refused>
    readonly names: ReadonlySet<string>
}

/** What the receipts are written from. */
interface ReceiptInput {
    readonly packageKey: string
    readonly request: CellSeedRequest
    readonly report: SeedReport
    readonly plainExists: boolean
}

/** Thrown inside a dry run's transaction to roll it back. */
class DryRunRollback extends Error {}

/** Cells that need no other cell come first; a tool with a confirmation read, then a node, after the tools they name. */
const rankOf = (file: CellFile): number => (file.kind === "node" ? 2 : file.kind === "tool" && file.semantics.confirmBy !== undefined ? 1 : 0)

/** The ref text a package folder stands for (`cells/tool/x/v1` is `tool:x@1`, `graphs/g/v2` is `graph:g@2`). */
const refOfDir = (dir: string): string => {
    const parts = dir.split("/")
    return parts[0] === "graphs" ? `graph:${String(parts[1])}@${String(parts[2]).slice(1)}` : `${String(parts[1])}:${String(parts[2])}@${String(parts[3]).slice(1)}`
}

const refusalOf = (ref: string, cause: unknown): Refused => {
    if (cause instanceof CellsError) return { ref, code: cause.code, params: cause.params as JsonObject }
    throw cause
}

@Injectable()
/**
 * The seed of one V2 package (CELLS-PLAN 3, seeds-and-data rules 9-10): reads the package files, judges every cell and graph with
 * `CellValidationService`, writes what is good through the one writer inside one transaction (a bad thing is refused with its code while the rest
 * seeds), and writes the receipt. A commit already applied is skipped whole; a declared force applies it once more, every row `unchanged` when the
 * files did not change; a version the package no longer holds is REPORTED, never deleted. The package files arrive as a map (the cli reads the
 * checkout), so nothing here touches a file system.
 */
export class CellSeedService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectCellDefinitionsWriter() private readonly writer: CellDefinitionsWriter,
        private readonly validation: CellValidationService,
    ) {}

    /** Every check, no write and no database: the lines say what is good and what is refused, `READY` when nothing is refused. */
    async check(files: CellPackageFiles): Promise<CellSeedView> {
        const judged = await this.judge(files)
        const lines = [
            `${judged.manifest.key}@${judged.manifest.version}`,
            ...judged.cells.map((cell) => `ok ${cellRefText(cell.file)}`),
            ...judged.graphs.map((graph) => `ok ${graphRefText(graph.file)}`),
            ...judged.refused.map(refusedLine),
            judged.refused.length === 0 ? "READY" : `NOT READY: ${String(judged.refused.length)} refused`,
        ]
        return { ready: judged.refused.length === 0, lines }
    }

    /** Applies the package at its commit (or, dry, shows exactly what would happen). */
    async apply(request: CellSeedRequest): Promise<CellSeedView> {
        const judged = await this.judge(request.files)
        const { manifest } = judged
        const { commit } = request.origin
        const head = `${manifest.key}@${manifest.version} at ${commit}`
        const plain = await this.entityManager.exists(CellSeedReceiptEntity, { where: { packageKey: manifest.key, commit, forced: false } })
        const forced = await this.entityManager.exists(CellSeedReceiptEntity, { where: { packageKey: manifest.key, commit, forced: true } })
        if (request.force ? forced : plain) {
            return { ready: true, lines: [head, request.force ? `force already applied at ${commit}: nothing done` : `already seeded at ${commit}: nothing done`, "skipped"] }
        }
        let report: SeedReport | null = null
        try {
            await this.entityManager.transaction(async (manager) => {
                report = await this.write(manager, judged, request, plain)
                if (request.dry) throw new DryRunRollback()
            })
        } catch (cause: unknown) {
            if (!(cause instanceof DryRunRollback)) throw cause
        }
        const done = report as SeedReport | null
        if (done === null) throw new CellsError({ code: CellsErrorCode.PackageInvalid, params: { file: "cells.package.yaml", reason: "nothing was written" } })
        const tail = request.dry ? ["dry run: nothing written"] : [done.created.length > 0 ? "applied" : "unchanged"]
        return { ready: done.refused.length === 0, lines: [head, ...reportLines(done, request.dry), ...tail] }
    }

    /** Reads the package and runs every check on every cell, then every graph; the cells a graph names must have passed. */
    private async judge(files: CellPackageFiles): Promise<Judged> {
        const content = readCellPackage(files)
        const refused: Array<Refused> = content.faults.map((fault) => ({
            ref: refOfDir(fault.dir),
            code: CellsErrorCode.PackageInvalid,
            params: { file: fault.file, reason: fault.reason },
        }))
        const names = new Set<string>([...content.cells.map((cell) => cellRefText(cell.file)), ...content.graphs.map((graph) => graphRefText(graph.file)), ...content.faults.map((fault) => refOfDir(fault.dir))])
        const accepted = new Map<string, CellFile>()
        const cells: Array<PackageCell> = []
        await eachInOrder([...content.cells].sort((a, b) => rankOf(a.file) - rankOf(b.file)), async (cell) => {
            try {
                await this.validation.validateCell(cell, accepted)
                accepted.set(cellRefText(cell.file), cell.file)
                cells.push(cell)
            } catch (cause: unknown) {
                refused.push(refusalOf(cellRefText(cell.file), cause))
            }
        })
        const graphs: Array<PackageGraph> = []
        await eachInOrder(content.graphs, async (graph) => {
            try {
                await this.validation.validateGraph(graph, accepted)
                graphs.push(graph)
            } catch (cause: unknown) {
                refused.push(refusalOf(graphRefText(graph.file), cause))
            }
        })
        return { manifest: content.manifest, cells, graphs, refused, names }
    }

    /** Writes the package, thing by thing, each in its own savepoint; then the receipt (unless dry). */
    private async write(manager: EntityManager, judged: Judged, request: CellSeedRequest, plainExists: boolean): Promise<SeedReport> {
        const { manifest } = judged
        const reviewRef = `${request.origin.repository}@${request.origin.commit}`
        const packageId = await this.writer.putPackage(manager, manifest, request.origin)
        const created: Array<string> = []
        const unchanged: Array<string> = []
        const refused: Array<Refused> = [...judged.refused]
        const settle = (ref: string, result: "created" | "unchanged"): void => {
            if (result === "created") created.push(ref)
            else unchanged.push(ref)
        }
        await eachInOrder(judged.cells, async (cell) => {
            const ref = cellRefText(cell.file)
            try {
                await manager.transaction(async (inner) => {
                    const origin = `${manifest.key}@${request.origin.commit}:${cell.dir}/${cell.origin ?? cell.file.source ?? ""}`
                    const source =
                        cell.sourceText === null
                            ? null
                            : { id: await this.writer.putSource(inner, { text: cell.sourceText, authorKind: "package", authorRef: origin }), sha256: sha256Of(cell.sourceText) }
                    settle(ref, await this.writer.putDefinition(inner, packageId, validatedCellOf(cell.file, source, reviewRef)))
                    if (cell.file.reviewState === "retired") await this.writer.retire(inner, cell.file)
                })
            } catch (cause: unknown) {
                refused.push(refusalOf(ref, cause))
            }
        })
        await eachInOrder(judged.graphs, async (graph) => {
            const ref = graphRefText(graph.file)
            try {
                await manager.transaction(async (inner) => {
                    settle(ref, await this.writer.putGraph(inner, packageId, validatedGraphOf(graph.file, reviewRef)))
                })
            } catch (cause: unknown) {
                refused.push(refusalOf(ref, cause))
            }
        })
        const report: SeedReport = { created, unchanged, refused, notInPackage: await this.removedFrom(manager, judged) }
        if (!request.dry) await this.writeReceipts(manager, { packageKey: manifest.key, request, report, plainExists })
        return report
    }

    /** What the last receipt of this package named and the package no longer holds: reported again until it is back, never deleted. */
    private async removedFrom(manager: EntityManager, judged: Judged): Promise<ReadonlyArray<string>> {
        const [last] = await manager.find(CellSeedReceiptEntity, { where: { packageKey: judged.manifest.key }, order: { createdAt: "DESC" }, take: 1 })
        if (last === undefined) return []
        const before = [...last.report.created, ...last.report.unchanged, ...last.report.notInPackage]
        return [...new Set(before)].filter((ref) => !judged.names.has(ref)).sort()
    }

    /** The receipt: forced when the stack's force is being used, and the plain one too when the commit had none. */
    private async writeReceipts(manager: EntityManager, input: ReceiptInput): Promise<void> {
        const { packageKey, request, report, plainExists } = input
        const base = { packageKey, repository: request.origin.repository, commit: request.origin.commit, report }
        if (request.force) await this.writer.receipt(manager, { ...base, forced: true })
        if (!plainExists) await this.writer.receipt(manager, { ...base, forced: false })
    }
}

/** One line per thing a report holds. */
const reportLines = (report: SeedReport, dry: boolean): ReadonlyArray<string> => [
    ...report.created.map((ref) => `${dry ? "would create" : "created"} ${ref}`),
    ...report.unchanged.map((ref) => `unchanged ${ref}`),
    ...report.refused.map(refusedLine),
    ...report.notInPackage.map((ref) => `no longer in the package: ${ref} (kept, never deleted)`),
]

const refusedLine = (item: Refused): string => `refused ${item.ref} ${item.code} ${JSON.stringify(item.params)}`
