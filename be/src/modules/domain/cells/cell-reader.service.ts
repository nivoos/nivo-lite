import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import type { CellReader } from "./cell-reader.port"
import { definitionHashOf, documentHashOf, graphRefTextOf, refTextOf, sha256Of } from "./cell-hash.policy"
import type { CellDefinitionView, CellGraphView, CellListFilter, CellRef, CellSourceView, GraphRef } from "./cells.contracts"
import { CellsError, CellsErrorCode } from "./errors/cells.error"
import { CellDefinitionEntity, CellGraphEntity, CellPackageEntity, CellSourceEntity } from "./persistence/entities"

/** How many definitions, graphs and sources the process keeps (CELLS-PLAN 2.3: 2,000 definitions and 500 sources; graphs are few and large). */
export const CELL_CACHE_LIMITS = { definitions: 2000, graphs: 500, sources: 500 } as const

/** A bounded map that drops its least recently used entry when it is full. Each view carries its own hash, so a cached answer is the one that was read with it. */
class BoundedCache<View> {
    private readonly entries = new Map<string, View>()

    constructor(private readonly limit: number) {}

    get(key: string): View | undefined {
        const view = this.entries.get(key)
        if (view === undefined) return undefined
        this.entries.delete(key)
        this.entries.set(key, view)
        return view
    }

    set(key: string, view: View): void {
        this.entries.delete(key)
        this.entries.set(key, view)
        const oldest = this.entries.keys().next()
        if (this.entries.size > this.limit && oldest.done !== true) this.entries.delete(oldest.value)
    }

    delete(key: string): void {
        this.entries.delete(key)
    }
}

@Injectable()
/**
 * The ONE way the engine sees a cell (CELLS-PLAN 2.3). It reads rows through the entities, checks that each row still hashes to the hash it was
 * written with (a row that does not is refused, never served), and keeps the answers in bounded in-process caches keyed by the exact reference (each
 * view carries the hash it was read with). A version row is immutable, so a cached entry never goes stale in its content; its `reviewState` and `deleted` flags are the
 * two things that may change later (retire, soft delete), and they matter only to listings, which are never cached. A process that retires or deletes
 * a version calls `invalidate` so its own next read sees the flags.
 */
export class CellReaderService implements CellReader {
    private readonly definitions = new BoundedCache<CellDefinitionView>(CELL_CACHE_LIMITS.definitions)
    private readonly graphs = new BoundedCache<CellGraphView>(CELL_CACHE_LIMITS.graphs)
    private readonly sources = new BoundedCache<CellSourceView>(CELL_CACHE_LIMITS.sources)

    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** The exact version, deleted or not (a pinned run finishes); throws `CELLS_UNKNOWN`. */
    async definition(ref: CellRef): Promise<CellDefinitionView> {
        const key = refTextOf(ref)
        const cached = this.definitions.get(key)
        if (cached !== undefined) return cached
        const row = await this.entityManager.findOne(CellDefinitionEntity, {
            where: { kind: ref.kind, key: ref.key, version: ref.version },
        })
        if (row === null) throw new CellsError({ code: CellsErrorCode.Unknown, params: { ref: key } })
        if (definitionHashOf(row) !== row.definitionHash) {
            throw new CellsError({ code: CellsErrorCode.VersionImmutable, params: { ref: key } })
        }
        const owner = await this.entityManager.findOneByOrFail(CellPackageEntity, { id: row.packageId })
        const view: CellDefinitionView = {
            kind: row.kind,
            key: row.key,
            version: row.version,
            id: row.id,
            packageKey: owner.key,
            title: row.title,
            inputSchema: row.inputSchema,
            outputSchema: row.outputSchema,
            configSchema: row.configSchema,
            semantics: row.semantics,
            body: row.body,
            sourceSha256: row.sourceSha256,
            examples: row.examples,
            definitionHash: row.definitionHash,
            reviewState: row.reviewState,
            deleted: row.deletedAt !== null,
        }
        this.definitions.set(key, view)
        return view
    }

    /** The exact graph version, deleted or not; throws `CELLS_UNKNOWN`. */
    async graph(ref: GraphRef): Promise<CellGraphView> {
        const key = graphRefTextOf(ref)
        const cached = this.graphs.get(key)
        if (cached !== undefined) return cached
        const row = await this.entityManager.findOne(CellGraphEntity, { where: { key: ref.key, version: ref.version } })
        if (row === null) throw new CellsError({ code: CellsErrorCode.Unknown, params: { ref: key } })
        if (documentHashOf(row.document) !== row.documentHash) {
            throw new CellsError({ code: CellsErrorCode.VersionImmutable, params: { ref: key } })
        }
        const view: CellGraphView = {
            key: row.key,
            version: row.version,
            id: row.id,
            document: row.document,
            documentHash: row.documentHash,
            deleted: row.deletedAt !== null,
        }
        this.graphs.set(key, view)
        return view
    }

    /** The source of a sha256; throws `CELLS_UNKNOWN`, or `CELLS_SOURCE_HASH_MISMATCH` for a row whose text no longer hashes to its sha256. */
    async source(sha256: string): Promise<CellSourceView> {
        const cached = this.sources.get(sha256)
        if (cached !== undefined) return cached
        const row = await this.entityManager.findOne(CellSourceEntity, { where: { sha256 } })
        if (row === null) throw new CellsError({ code: CellsErrorCode.Unknown, params: { ref: sha256 } })
        if (sha256Of(row.text) !== row.sha256) {
            throw new CellsError({ code: CellsErrorCode.SourceHashMismatch, params: { sha256 } })
        }
        const view: CellSourceView = { sha256: row.sha256, language: row.language, text: row.text }
        this.sources.set(sha256, view)
        return view
    }

    /** The refs of approved, not deleted cells of a package that is not deleted and is visible to the enterprise, in kind, key and version order. */
    async listed(filter: CellListFilter): Promise<ReadonlyArray<CellRef>> {
        const query = this.entityManager
            .createQueryBuilder(CellDefinitionEntity, "d")
            .innerJoin(CellPackageEntity, "p", "p.id = d.package_id")
            .select(["d.kind", "d.key", "d.version"])
            .where("d.review_state = 'approved'")
            .andWhere("d.deleted_at IS NULL")
            .andWhere("p.deleted_at IS NULL")
        if (filter.kind !== undefined) query.andWhere("d.kind = :kind", { kind: filter.kind })
        if (filter.enterprise === null) query.andWhere("p.visibility = 'public'")
        else query.andWhere("(p.visibility = 'public' OR :enterprise = ANY(p.enterprises))", { enterprise: filter.enterprise })
        const rows = await query.orderBy("d.kind").addOrderBy("d.key").addOrderBy("d.version").getMany()
        return rows.map((row): CellRef => ({ kind: row.kind, key: row.key, version: row.version }))
    }

    /** Forgets a cached cell version, so the next read of it goes to the database (after a retire or a soft delete in this process). */
    invalidate(ref: CellRef): void {
        this.definitions.delete(refTextOf(ref))
    }

    /** Forgets a cached graph version. */
    invalidateGraph(ref: GraphRef): void {
        this.graphs.delete(graphRefTextOf(ref))
    }
}
