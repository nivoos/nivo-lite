import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { ofLiveContact } from "./live-contact.policy"
import { CustomerRouteEntity } from "./persistence/entities"
import type { StreamCursorStore } from "./stream-cursor-store.port"

/** A LIKE pattern that matches texts starting with `prefix` exactly (its own `%`, `_` and `\` escaped). */
export const prefixPatternOf = (prefix: string): string => `${prefix.replace(/[\\%_]/gu, (one) => `\\${one}`)}%`

@Injectable()
/** The stream cursor on public.customer_routes, on the primary connection; every write is one statement. No raw SQL. */
export class TypeormStreamCursorStore implements StreamCursorStore {
    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** The route's pending read becomes this call's (the same call keeps its newest line). */
    async noteRead(workspaceId: string, routeId: string, by: string, seq: string): Promise<boolean> {
        const moved = await this.entityManager
            .createQueryBuilder()
            .update(CustomerRouteEntity)
            .set({
                readSeq: () => "CASE WHEN read_by = :by THEN GREATEST(read_seq, CAST(:seq AS bigint)) ELSE CAST(:seq AS bigint) END",
                readBy: by,
            })
            .where("workspace_id = :workspaceId AND id = :routeId", { workspaceId, routeId })
            .setParameters({ by, seq })
            .execute()
        return (moved.affected ?? 0) > 0
    }

    /** Folds the pending reads of a step's calls into their routes' cursors and clears them. */
    async consume(workspaceId: string, prefix: string): Promise<number> {
        const moved = await this.entityManager
            .createQueryBuilder()
            .update(CustomerRouteEntity)
            .set({
                consumedSeq: () => "GREATEST(COALESCE(consumed_seq, read_seq), read_seq)",
                readSeq: null,
                readBy: null,
            })
            .where("workspace_id = :workspaceId AND read_by IS NOT NULL AND read_by LIKE :pattern ESCAPE '\\'", {
                workspaceId,
                pattern: prefixPatternOf(prefix),
            })
            .execute()
        return moved.affected ?? 0
    }

    /** The route's cursor, or null (none yet, or no live route). */
    async cursorOf(workspaceId: string, routeId: string): Promise<string | null> {
        const row = await ofLiveContact(this.entityManager.createQueryBuilder(CustomerRouteEntity, "route"), "route")
            .where("route.workspaceId = :workspaceId", { workspaceId })
            .andWhere("route.id = :routeId", { routeId })
            .getOne()
        return row?.consumedSeq ?? null
    }
}
