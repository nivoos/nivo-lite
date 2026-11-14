import { Injectable } from "@nestjs/common"
import { IsNull, type EntityManager } from "typeorm"
import { WorkspaceEntity } from "@modules/domain/workspaces"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import type { MaybeWorkspaceRef, WorkspaceDirectory } from "./data-stores.contracts"

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
}
