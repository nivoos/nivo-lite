import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { eachInOrder } from "@modules/platform/primitives"
import { StreamCursorEntity } from "./persistence/entities"
import type { StreamCursorStore, StreamRef } from "./stream-cursor-store.port"

/** A LIKE pattern that matches texts starting with `prefix` exactly (its own `%`, `_` and `\` escaped). */
export const prefixPatternOf = (prefix: string): string => `${prefix.replace(/[\\%_]/gu, (one) => `\\${one}`)}%`

/** The key columns of one cursor row. */
const keyOf = (workspaceId: string, ref: StreamRef) => ({ workspaceId, agentId: ref.agentId, stream: ref.stream, subject: ref.subject })

@Injectable()
/** The stream cursors on public.stream_cursors, on the primary connection; every write is one or two statements. No raw SQL. */
export class TypeormStreamCursorStore implements StreamCursorStore {
    constructor(@InjectPrimaryEntityManager() private readonly entityManager: EntityManager) {}

    /** The consumer's pending read on the subject becomes this call's (the same call keeps its newest). */
    async noteRead(workspaceId: string, ref: StreamRef, by: string, seq: string): Promise<void> {
        // The row exists first (insert-or-nothing on its key), then one update decides the pending read.
        await this.entityManager
            .createQueryBuilder()
            .insert()
            .into(StreamCursorEntity)
            .values({ ...keyOf(workspaceId, ref), consumedSeq: null, readSeq: null, readBy: null })
            .orIgnore()
            .execute()
        await this.entityManager
            .createQueryBuilder()
            .update(StreamCursorEntity)
            .set({
                readSeq: () => "CASE WHEN read_by = :by THEN GREATEST(read_seq, CAST(:seq AS bigint)) ELSE CAST(:seq AS bigint) END",
                readBy: by,
            })
            .where("workspace_id = :workspaceId AND agent_id = :agentId AND stream = :stream AND subject = :subject", keyOf(workspaceId, ref))
            .setParameters({ by, seq })
            .execute()
    }

    /** Folds the pending reads of a step's calls into their cursors and clears them. */
    async consume(workspaceId: string, prefix: string): Promise<number> {
        const moved = await this.entityManager
            .createQueryBuilder()
            .update(StreamCursorEntity)
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

    /** The consumer's cursor, or null (none yet). */
    async cursorOf(workspaceId: string, ref: StreamRef): Promise<string | null> {
        const row = await this.entityManager.findOne(StreamCursorEntity, { where: keyOf(workspaceId, ref) })
        return row?.consumedSeq ?? null
    }

    /**
     * Joins every cursor on `from` into the same consumer's cursor on `into` (the greater of the two; a consumer with no row on `into` gets
     * one), then removes `from`'s rows: in one transaction of the caller's choosing (the merge's).
     */
    async merge(workspaceId: string, from: string, into: string): Promise<number> {
        return this.entityManager.transaction(async (tx) => {
            const loser = await tx.find(StreamCursorEntity, { where: { workspaceId, subject: from } })
            await eachInOrder(loser, async (row) => {
                const ref = { agentId: row.agentId, stream: row.stream, subject: into }
                const kept = await tx.findOne(StreamCursorEntity, { where: keyOf(workspaceId, ref) })
                const consumed = greaterOf(kept?.consumedSeq ?? null, row.consumedSeq)
                await tx.save(StreamCursorEntity, { ...keyOf(workspaceId, ref), consumedSeq: consumed, readSeq: kept?.readSeq ?? null, readBy: kept?.readBy ?? null })
                await tx.delete(StreamCursorEntity, keyOf(workspaceId, { ...ref, subject: from }))
            })
            return loser.length
        })
    }
}

/** The greater of two positions (bigint as text), null only when both are. */
const greaterOf = (left: string | null, right: string | null): string | null => {
    if (left === null) return right
    if (right === null) return left
    return BigInt(right) > BigInt(left) ? right : left
}
