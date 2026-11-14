import { Inject, Injectable } from "@nestjs/common"
import type { ScopedTx } from "@modules/domain/entity-engine"
import { AGENT_GRAPH_STORE, type AgentGraphStore } from "./agent-graph-store.port"
import type {
    EnsuredGraph,
    GraphInsert,
    GraphPatch,
    GraphRecord,
    VersionInsert,
    VersionRecord,
} from "./agent-graphs-records.contracts"

/** What a write answers when its record exists: the record after, or null when its version had moved on. */
type Written<T> = T | null


@Injectable()
/**
 * The one place the graph engine reads and writes the graphs of the agents and what hangs off them, on their core tables
 * (`AGENT_GRAPH_STORE`): a patch under the version (fence) the caller read. Every method runs in the transaction of the `ScopedTx` it is
 * given and never opens one.
 */
export class AgentGraphRecordsService {
    constructor(@Inject(AGENT_GRAPH_STORE) private readonly store: AgentGraphStore) {}

    /** The graph of an agent, or null. */
    graphOf(tx: ScopedTx, agentId: string): Promise<GraphRecord | null> {
        return this.store.graph(tx, { agentId })
    }

    /** The graph of an installation, or null. */
    graphOfInstallation(tx: ScopedTx, installationId: string): Promise<GraphRecord | null> {
        return this.store.graph(tx, { installationId })
    }

    /** The ids among these agents that hold a graph. */
    async agentsWithGraph(tx: ScopedTx, agentIds: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
        return (await this.store.graphs(tx, agentIds, agentIds.length)).map((graph) => graph.agentId)
    }

    /** The graph of the agent, found or made. */
    ensureGraph(tx: ScopedTx, values: GraphInsert): Promise<EnsuredGraph> {
        return this.store.ensureGraph(tx, values)
    }

    /** Writes the graph's fields under the version the caller read: the graph after, or null when its version had moved on. */
    patchGraph(tx: ScopedTx, graph: GraphRecord, values: GraphPatch): Promise<Written<GraphRecord>> {
        return this.store.patchGraph(tx, graph.id, graph.fence, values)
    }

    /** One version, or null. */
    version(tx: ScopedTx, versionId: string): Promise<VersionRecord | null> {
        return this.store.version(tx, versionId)
    }

    /** The newest version of the agent, or null. */
    async latestVersion(tx: ScopedTx, agentId: string): Promise<VersionRecord | null> {
        return (await this.store.versions(tx, agentId, 1)).at(0) ?? null
    }

    /** The versions of the agent, newest first, at most `limit`. */
    versionsOf(tx: ScopedTx, agentId: string, limit: number): Promise<ReadonlyArray<VersionRecord>> {
        return this.store.versions(tx, agentId, limit)
    }

    /** Inserts a version; null when its number is already the agent's. */
    insertVersion(tx: ScopedTx, values: VersionInsert): Promise<VersionRecord | null> {
        return this.store.addVersion(tx, values)
    }
}
