import { Injectable } from "@nestjs/common"
import { In, type EntityManager, type EntityTarget, type ObjectLiteral } from "typeorm"
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity"
import type { ScopedTx } from "@modules/domain/entity-engine"
import type { AgentGraphStore, GraphLookup } from "./agent-graph-store.port"
import { AgentGraphsError, AgentGraphsErrorCode } from "./errors/agent-graphs.error"
import { graphRecordOf, versionRecordOf } from "./agent-graphs.mapper"
import type {
    EnsuredGraph,
    GraphInsert,
    GraphPatch,
    GraphRecord,
    VersionInsert,
    VersionRecord,
} from "./agent-graphs-records.contracts"
import { AgentGraphEntity, AgentGraphVersionEntity } from "./persistence/entities"

const unreadable = (): AgentGraphsError => new AgentGraphsError({ code: AgentGraphsErrorCode.RecordUnreadable })

/** True when an insert wrote its row: Postgres answers the inserted rows, none when the conflict left it out. */
const insertedOf = (raw: unknown): boolean => Array.isArray(raw) && raw.length > 0

/** An ISO text or null as the instant a column keeps. */
const instantOf = (value: string | null): Date | null => (value === null ? null : new Date(value))

const graphColumnsOf = (patch: GraphPatch): QueryDeepPartialEntity<AgentGraphEntity> => ({
    ...(patch.draft === undefined ? {} : { draft: structuredClone(patch.draft) }),
    ...(patch.draftRev === undefined ? {} : { draftRev: patch.draftRev }),
    ...(patch.activeVersionId === undefined ? {} : { activeVersionId: patch.activeVersionId }),
    ...(patch.mode === undefined ? {} : { mode: patch.mode }),
    ...(patch.modeSetBy === undefined ? {} : { modeSetBy: patch.modeSetBy }),
    ...(patch.modeSetAt === undefined ? {} : { modeSetAt: instantOf(patch.modeSetAt) }),
})

@Injectable()
/** The graph store on its five core tables, in the caller's transaction (`ScopedTx.manager`). No raw SQL. */
export class TypeormAgentGraphStore implements AgentGraphStore {
    /** The graph of the workspace that matches the lookup, or null. */
    async graph(tx: ScopedTx, lookup: GraphLookup): Promise<GraphRecord | null> {
        const row = await tx.manager.findOne(AgentGraphEntity, {
            where: { workspaceId: tx.workspaceId, ...lookup },
            order: { id: "ASC" },
        })
        return row === null ? null : graphRecordOf(row)
    }

    /** The graphs of the given agents (all agents of the workspace when null), by agent, at most `limit`. */
    async graphs(
        tx: ScopedTx,
        agentIds: ReadonlyArray<string> | null,
        limit: number,
    ): Promise<ReadonlyArray<GraphRecord>> {
        if (agentIds?.length === 0) return []
        const rows = await tx.manager.find(AgentGraphEntity, {
            where: { workspaceId: tx.workspaceId, ...(agentIds === null ? {} : { agentId: In([...agentIds]) }) },
            order: { agentId: "ASC", id: "ASC" },
            take: limit,
        })
        return rows.map((item) => graphRecordOf(item))
    }

    /** Creates the graph of an agent unless it exists, and returns the row with whether this call created it. */
    async ensureGraph(tx: ScopedTx, graph: GraphInsert): Promise<EnsuredGraph> {
        const inserted = await this.insertIgnoring(tx.manager, AgentGraphEntity, {
            workspaceId: tx.workspaceId,
            agentId: graph.agentId,
            installationId: graph.installationId,
            draft: structuredClone(graph.draft),
            draftRev: graph.draftRev,
            mode: graph.mode,
        })
        const found = await this.graph(tx, { agentId: graph.agentId })
        if (found === null) throw unreadable()
        return { graph: found, created: inserted }
    }

    /** Applies a patch to a graph when `fence` still matches its stored fence: the new row, or null when the fence moved. */
    async patchGraph(tx: ScopedTx, id: string, fence: string, patch: GraphPatch): Promise<GraphRecord | null> {
        const moved = await this.fenced(tx, AgentGraphEntity, id, fence, graphColumnsOf(patch))
        if (!moved) return null
        const row = await tx.manager.findOne(AgentGraphEntity, { where: { workspaceId: tx.workspaceId, id } })
        return row === null ? null : graphRecordOf(row)
    }

    /** One version of a graph by id, or null. */
    async version(tx: ScopedTx, id: string): Promise<VersionRecord | null> {
        const row = await tx.manager.findOne(AgentGraphVersionEntity, { where: { workspaceId: tx.workspaceId, id } })
        return row === null ? null : versionRecordOf(row)
    }

    /** The versions of an agent graph, newest first, at most `limit`. */
    async versions(tx: ScopedTx, agentId: string, limit: number): Promise<ReadonlyArray<VersionRecord>> {
        const rows = await tx.manager.find(AgentGraphVersionEntity, {
            where: { workspaceId: tx.workspaceId, agentId },
            order: { number: "DESC", id: "DESC" },
            take: limit,
        })
        return rows.map((item) => versionRecordOf(item))
    }

    /** Writes the next version of a graph: the row, or null when that number is already written. */
    async addVersion(tx: ScopedTx, version: VersionInsert): Promise<VersionRecord | null> {
        const inserted = await this.insertIgnoring(tx.manager, AgentGraphVersionEntity, {
            workspaceId: tx.workspaceId,
            agentId: version.agentId,
            number: version.number,
            document: structuredClone(version.document),
            documentHash: version.documentHash,
            contextVersionId: version.contextVersionId,
            changeKind: version.changeKind,
            note: version.note,
            publishedBy: version.publishedBy,
            ...(version.publishedAt === undefined ? {} : { publishedAt: new Date(version.publishedAt) }),
        })
        if (!inserted) return null
        const row = await tx.manager.findOne(AgentGraphVersionEntity, {
            where: { workspaceId: tx.workspaceId, agentId: version.agentId, number: version.number },
        })
        return row === null ? null : versionRecordOf(row)
    }

    /** Inserts one row unless a unique key holds it already (`ON CONFLICT DO NOTHING`): true when this call wrote it. */
    private async insertIgnoring<T extends ObjectLiteral>(
        manager: EntityManager,
        target: EntityTarget<T>,
        values: QueryDeepPartialEntity<T>,
    ): Promise<boolean> {
        const result = await manager.createQueryBuilder().insert().into(target).values(values).orIgnore().returning(["id"]).execute()
        return insertedOf(result.raw)
    }

    /** Writes members of one row at the version read, bumping it: true when the row stood at that version. */
    private async fenced<T extends ObjectLiteral>(
        tx: ScopedTx,
        target: EntityTarget<T>,
        id: string,
        fence: string,
        columns: QueryDeepPartialEntity<T>,
    ): Promise<boolean> {
        const result = await tx.manager
            .createQueryBuilder()
            .update(target)
            .set({ ...columns, version: () => "version + 1" })
            .where({ workspaceId: tx.workspaceId, id, version: Number(fence) })
            .execute()
        return (result.affected ?? 0) > 0
    }
}
