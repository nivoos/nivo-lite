import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import type { CellDefinitionsWriter } from "./cell-definitions-writer.port"
import { definitionHashOf, documentHashOf, graphRefTextOf, refTextOf, sha256Of } from "./cell-hash.policy"
import type {
    CellPackageFile,
    CellPackageOrigin,
    CellRef,
    CellSourceInput,
    GraphRef,
    SeedReceiptInput,
    SeedReport,
    ValidatedCell,
    ValidatedGraph,
} from "./cells.contracts"
import { CellsError, CellsErrorCode } from "./errors/cells.error"
import {
    CellDefinitionEntity,
    CellGraphEntity,
    CellPackageEntity,
    CellSeedReceiptEntity,
    CellSourceEntity,
} from "./persistence/entities"

@Injectable()
/**
 * The ONLY writer of the `cells.*` tables (CELLS-PLAN 2.1). Every method takes the caller's manager, so the seed writes a whole package in one
 * transaction. A version is inserted once: the same content again answers `unchanged`, other content throws `CELLS_VERSION_IMMUTABLE` (the service
 * refuses first; the database triggers refuse whatever else writes). The hash is computed here, never taken from the caller.
 */
export class CellDefinitionsService implements CellDefinitionsWriter {
    /** Finds the package version row or inserts it, and answers its id; the same version with another visibility, enterprise list or author is refused. */
    async putPackage(manager: EntityManager, file: CellPackageFile, origin: CellPackageOrigin): Promise<string> {
        const enterprises = [...(file.enterprises ?? [])]
        const found = await manager.findOne(CellPackageEntity, { where: { key: file.key, version: file.version } })
        if (found !== null) {
            const same =
                found.visibility === file.visibility &&
                found.author === file.author &&
                found.enterprises.length === enterprises.length &&
                found.enterprises.every((enterprise, index) => enterprise === enterprises[index])
            if (!same) {
                throw new CellsError({
                    code: CellsErrorCode.VersionImmutable,
                    params: { ref: `package:${file.key}@${file.version}` },
                })
            }
            return found.id
        }
        const saved = await manager.save(CellPackageEntity, {
            key: file.key,
            version: file.version,
            visibility: file.visibility,
            enterprises,
            author: file.author,
            repository: origin.repository,
            commit: origin.commit,
        })
        return saved.id
    }

    /** Stores a source by its sha256 (the text is never updated) and answers its id. */
    async putSource(manager: EntityManager, source: CellSourceInput): Promise<string> {
        const sha256 = sha256Of(source.text)
        const found = await manager.findOne(CellSourceEntity, { where: { sha256 } })
        if (found !== null) return found.id
        const saved = await manager.save(CellSourceEntity, {
            language: "js-quickjs@1",
            text: source.text,
            sha256,
            bytes: Buffer.byteLength(source.text, "utf8"),
            authorKind: source.authorKind,
            authorRef: source.authorRef,
        })
        return saved.id
    }

    /** Inserts a version row; the same content answers `unchanged`; other content throws `CELLS_VERSION_IMMUTABLE`. */
    async putDefinition(
        manager: EntityManager,
        packageId: string,
        candidate: ValidatedCell,
    ): Promise<"created" | "unchanged"> {
        const definitionHash = definitionHashOf({ ...candidate, sourceSha256: candidate.source?.sha256 ?? null })
        const found = await manager.findOne(CellDefinitionEntity, {
            where: { kind: candidate.kind, key: candidate.key, version: candidate.version },
        })
        if (found !== null) {
            if (found.definitionHash !== definitionHash) {
                throw new CellsError({ code: CellsErrorCode.VersionImmutable, params: { ref: refTextOf(candidate) } })
            }
            return "unchanged"
        }
        await manager.save(
            Object.assign(new CellDefinitionEntity(), {
                packageId,
                kind: candidate.kind,
                key: candidate.key,
                version: candidate.version,
                title: candidate.title,
                inputSchema: candidate.inputSchema,
                outputSchema: candidate.outputSchema,
                configSchema: candidate.configSchema,
                semantics: candidate.semantics,
                body: candidate.body,
                sourceId: candidate.source?.id ?? null,
                sourceSha256: candidate.source?.sha256 ?? null,
                examples: candidate.examples,
                definitionHash,
                reviewState: candidate.reviewState,
                reviewRef: candidate.reviewRef,
                publishedAt: candidate.reviewState === "draft" ? null : new Date(),
            }),
        )
        return "created"
    }

    /** Inserts a graph version row, with the same rule as `putDefinition`; the `triggers` column is the document's trigger list. */
    async putGraph(manager: EntityManager, packageId: string, graph: ValidatedGraph): Promise<"created" | "unchanged"> {
        const documentHash = documentHashOf(graph.document)
        const found = await manager.findOne(CellGraphEntity, { where: { key: graph.key, version: graph.version } })
        if (found !== null) {
            if (found.documentHash !== documentHash) {
                throw new CellsError({ code: CellsErrorCode.VersionImmutable, params: { ref: graphRefTextOf(graph) } })
            }
            return "unchanged"
        }
        await manager.save(
            Object.assign(new CellGraphEntity(), {
                packageId,
                key: graph.key,
                version: graph.version,
                document: graph.document,
                triggers: graph.document.triggers,
                documentHash,
                reviewState: graph.reviewState,
                reviewRef: graph.reviewRef,
                publishedAt: graph.reviewState === "draft" ? null : new Date(),
            }),
        )
        return "created"
    }

    /** Moves a version to `retired`, the one change an approved row may take (retiring a retired row changes nothing). */
    async retire(manager: EntityManager, ref: CellRef): Promise<void> {
        const found = await this.definitionOf(manager, ref)
        if (found.reviewState === "retired") return
        await manager.update(CellDefinitionEntity, { id: found.id }, { reviewState: "retired" })
    }

    /** Moves a graph version to `retired`. */
    async retireGraph(manager: EntityManager, ref: GraphRef): Promise<void> {
        const found = await this.graphOf(manager, ref)
        if (found.reviewState === "retired") return
        await manager.save(Object.assign(found, { reviewState: "retired" as const }))
    }

    /** Soft-deletes a cell version: it stays readable by its exact ref and leaves every listing (a deleted row stays deleted). */
    async softDelete(manager: EntityManager, ref: CellRef): Promise<void> {
        const found = await this.definitionOf(manager, ref)
        if (found.deletedAt !== null) return
        await manager.update(CellDefinitionEntity, { id: found.id }, { deletedAt: new Date() })
    }

    /** Soft-deletes a graph version. */
    async softDeleteGraph(manager: EntityManager, ref: GraphRef): Promise<void> {
        const found = await this.graphOf(manager, ref)
        if (found.deletedAt !== null) return
        await manager.save(Object.assign(found, { deletedAt: new Date() }))
    }

    /** Soft-deletes a package version: its cells leave every listing; pinned runs still read them by exact ref. */
    async softDeletePackage(manager: EntityManager, key: string, version: string): Promise<void> {
        const found = await manager.findOne(CellPackageEntity, { where: { key, version } })
        if (found === null) {
            throw new CellsError({ code: CellsErrorCode.Unknown, params: { ref: `package:${key}@${version}` } })
        }
        if (found.deletedAt !== null) return
        await manager.update(CellPackageEntity, { id: found.id }, { deletedAt: new Date() })
    }

    /** Writes the receipt of an applied package commit; the same (package, commit, forced) again changes nothing (the first report stays). */
    async receipt(manager: EntityManager, receipt: SeedReceiptInput): Promise<void> {
        if (await this.receiptExists(manager, receipt.packageKey, receipt.commit, receipt.forced)) return
        await manager.save(
            Object.assign(new CellSeedReceiptEntity(), {
                packageKey: receipt.packageKey,
                repository: receipt.repository,
                commit: receipt.commit,
                forced: receipt.forced,
                report: receipt.report,
            }),
        )
    }

    /** Whether a package commit was applied already (plain, or forced as asked): the seed skips an applied commit and applies a forced one once. */
    receiptExists(manager: EntityManager, packageKey: string, commit: string, forced: boolean): Promise<boolean> {
        return manager.exists(CellSeedReceiptEntity, { where: { packageKey, commit, forced } })
    }

    /** The report of the latest receipt of a package (by apply time), or null when it was never applied. */
    async lastReport(manager: EntityManager, packageKey: string): Promise<SeedReport | null> {
        const [last] = await manager.find(CellSeedReceiptEntity, {
            where: { packageKey },
            order: { createdAt: "DESC" },
            take: 1,
        })
        return last === undefined ? null : last.report
    }

    private async definitionOf(manager: EntityManager, ref: CellRef): Promise<CellDefinitionEntity> {
        const found = await manager.findOne(CellDefinitionEntity, {
            where: { kind: ref.kind, key: ref.key, version: ref.version },
        })
        if (found === null) throw new CellsError({ code: CellsErrorCode.Unknown, params: { ref: refTextOf(ref) } })
        return found
    }

    private async graphOf(manager: EntityManager, ref: GraphRef): Promise<CellGraphEntity> {
        const found = await manager.findOne(CellGraphEntity, { where: { key: ref.key, version: ref.version } })
        if (found === null) throw new CellsError({ code: CellsErrorCode.Unknown, params: { ref: graphRefTextOf(ref) } })
        return found
    }
}
