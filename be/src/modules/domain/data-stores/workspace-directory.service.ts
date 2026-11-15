import { Injectable } from "@nestjs/common"
import { IsNull, MoreThan, type EntityManager } from "typeorm"
import { WorkspaceEntity } from "@modules/domain/workspaces"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import type { MaybeWorkspaceRef, WorkspaceDirectory, WorkspaceRef } from "./data-stores.contracts"
import { isWorkspaceId } from "./data-stores.policy"

/** Workspaces read per page when every live workspace is listed. */
const LIST_PAGE = 500

@Injectable()
/**
 * Finds the workspace a store scope names by its natural key: the enterprise identifier first (`nivo-web`, unique across the platform),
 * else the name when exactly one live workspace carries it. A workspace's uuid is never a key of a copy.
 */
export class WorkspaceDirectoryService implements WorkspaceDirectory {
    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** The workspace the key names, or null when none or several do. */
    async resolve(natural: string): Promise<MaybeWorkspaceRef> {
        const keyed = await this.entityManager.findOne(WorkspaceEntity, {
            select: { id: true, ownerId: true, enterpriseKey: true },
            where: { enterpriseKey: natural, deletedAt: IsNull() },
        })
        if (keyed !== null) return { id: keyed.id, ownerId: keyed.ownerId }
        const named = await this.entityManager.find(WorkspaceEntity, {
            select: { id: true, ownerId: true },
            where: { name: natural, deletedAt: IsNull() },
            take: 2,
        })
        const [only, other] = named
        return only === undefined || other !== undefined ? null : { id: only.id, ownerId: only.ownerId }
    }

    /** Every live workspace, in workspace id order. */
    async all(): Promise<ReadonlyArray<WorkspaceRef>> {
        return this.pageAfter(undefined)
    }

    /** One page of live workspaces after an id, and every page after it (keyset: the pages are read in id order). */
    private async pageAfter(after: string | undefined): Promise<ReadonlyArray<WorkspaceRef>> {
        const rows = await this.entityManager.find(WorkspaceEntity, {
            select: { id: true, ownerId: true },
            where: after === undefined ? { deletedAt: IsNull() } : { deletedAt: IsNull(), id: MoreThan(after) },
            order: { id: "ASC" },
            take: LIST_PAGE,
        })
        const page = rows.map((row) => ({ id: row.id, ownerId: row.ownerId }))
        const last = page.at(-1)
        return rows.length < LIST_PAGE || last === undefined ? page : [...page, ...(await this.pageAfter(last.id))]
    }

    /** The live workspace with this id; a text that is no workspace id is not asked of the database (it would raise, not answer none). */
    async byId(workspaceId: string): Promise<MaybeWorkspaceRef> {
        if (!isWorkspaceId(workspaceId)) return null
        const row = await this.entityManager.findOne(WorkspaceEntity, {
            select: { id: true, ownerId: true },
            where: { id: workspaceId, deletedAt: IsNull() },
        })
        return row === null ? null : { id: row.id, ownerId: row.ownerId }
    }
}
