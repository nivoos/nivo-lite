import { Injectable } from "@nestjs/common"
import { IsNull, type EntityManager } from "typeorm"
import { advisoryXactLock } from "@modules/platform/database"
import { AccountDataEntity } from "./persistence/entities"

/** What one claim of a fact came to: this row is the first report of it, or it reports the same fact as an earlier row. */
export type FactClaim =
    | { readonly first: true }
    | { readonly first: false; readonly sameAs: { readonly type: string; readonly id: string } }

/** What a claim is told: the row (its type and id), its workspace and the fact key `<verb>:<the source's own identity of the fact>`. */
export interface FactClaimInput {
    readonly workspaceId: string
    readonly type: string
    readonly id: string
    readonly factKey: string
}

@Injectable()
/**
 * WHICH ROW FIRST REPORTED A FACT (owner R97, trigger `factKey`): the identity a source gives a fact is written on the raw row itself
 * (`fact_key`, no new table) and the later rows that report the same fact point at the first (`same_fact_of`). The claim runs in the
 * caller's transaction under an advisory lock on (workspace, fact key), so two deliveries of one fact racing in two transactions are
 * answered one after the other: the first to hold the lock is the first, the other finds it. The first is the row that CARRIES the key
 * and no `same_fact_of` (the claim order under the lock, not `created_at`, which is the start of a transaction). A row deleted by its
 * type's retention frees its key. Two types of two providers on one verb meet here: the key holds the verb, never the provider.
 */
export class AccountDataFactsService {
    /**
     * Claims the fact for the row: writes its `fact_key`, and `same_fact_of` when another row of the workspace holds the fact first.
     * Asking again for a row that already claimed answers what it answered then.
     */
    async claim(tx: EntityManager, input: FactClaimInput): Promise<FactClaim> {
        await advisoryXactLock(tx, `account-data-fact:${input.workspaceId}:${input.factKey}`)
        const self = await tx.findOne(AccountDataEntity, { where: { type: input.type, id: input.id } })
        if (self?.factKey === input.factKey) {
            return self.sameFactOf === null ? { first: true } : { first: false, sameAs: await this.rowOf(tx, self.sameFactOf) }
        }
        const earlier = await tx
            .createQueryBuilder(AccountDataEntity, "r")
            .select(["r.type", "r.id"])
            .where("r.workspace_id = :workspaceId", { workspaceId: input.workspaceId })
            .andWhere("r.fact_key = :factKey", { factKey: input.factKey })
            .andWhere("r.same_fact_of IS NULL")
            .andWhere("NOT (r.type = :type AND r.id = :id)", { type: input.type, id: input.id })
            .orderBy("r.created_at", "ASC")
            .addOrderBy("r.id", "ASC")
            .limit(1)
            .getOne()
        await tx.update(
            AccountDataEntity,
            { type: input.type, id: input.id },
            { factKey: input.factKey, sameFactOf: earlier === null ? null : earlier.id },
        )
        return earlier === null ? { first: true } : { first: false, sameAs: { type: earlier.type, id: earlier.id } }
    }

    /** The type and id of a row by its id (the earlier row a claimed row points at). */
    private async rowOf(tx: EntityManager, id: string): Promise<{ readonly type: string; readonly id: string }> {
        const row = await tx.findOne(AccountDataEntity, { where: { id, sameFactOf: IsNull() } })
        return row === null ? { type: "", id } : { type: row.type, id: row.id }
    }
}
