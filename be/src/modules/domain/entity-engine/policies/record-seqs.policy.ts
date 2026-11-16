import { RecordEntity } from "../persistence/entities"
import { agentKeyOf } from "./agent-scope.policy"
import type { ScopedTx } from "./scoped-tx.contracts"

/**
 * The stream positions (`seq`, bigint as text) of records of one type in the scope, by id (concept agent-data rule 5): what a consuming read
 * of an append-only type answers beside each record. A record written before the column existed has none (absent from the map).
 */
export const recordSeqsOf = async (tx: ScopedTx, entity: string, ids: ReadonlyArray<string>): Promise<ReadonlyMap<string, string>> => {
    if (ids.length === 0) return new Map()
    const agent = agentKeyOf(tx).agentId
    const query = tx.manager
        .createQueryBuilder(RecordEntity, "r")
        .select("r.id", "id")
        .addSelect("r.seq", "seq")
        .where("r.entity = :entity AND r.workspaceId = :workspaceId AND r.id IN (:...ids)", { entity, workspaceId: tx.workspaceId, ids: [...ids] })
    const rows: ReadonlyArray<{ readonly id: unknown; readonly seq: unknown }> = await (agent === undefined
        ? query
        : query.andWhere("r.agentId = :agent", { agent })
    ).getRawMany()
    return new Map(
        rows.flatMap((row) => (typeof row.id === "string" && (typeof row.seq === "string" || typeof row.seq === "number") ? [[row.id, String(row.seq)]] : [])),
    )
}
