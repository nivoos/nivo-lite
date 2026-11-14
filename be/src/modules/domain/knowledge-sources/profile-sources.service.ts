import { Injectable } from "@nestjs/common"
import { IsNull, MoreThan, Not, type EntityManager } from "typeorm"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { KnowledgeQueue } from "@modules/queues/knowledge"
import { KnowledgeSourcesError, KnowledgeSourcesErrorCode } from "./errors/knowledge-sources.error"
import type { ProfileDocument, ProfileSourceInput, ProfileSourceOutcome } from "./knowledge-sources.contracts"
import { KnowledgeSourceEntity } from "./persistence/entities"
import { NOW, metaChanges } from "./source-input.policy"

/** How many documents one listing statement reads. */
const DOCUMENT_PAGE = 500

@Injectable()
/**
 * The text documents a seed run keeps (the brain seed): each is found again by its origin
 * and title, and every row change is queued for the normal indexing in the same transaction. The caller has already proven the
 * workspace owner; the knowledge pages keep using KnowledgeSourcesService.
 */
export class ProfileSourcesService {
    constructor(
        @InjectPrimaryEntityManager() private readonly entityManager: EntityManager,
        @InjectClock() private readonly clock: Clock,
        private readonly queue: KnowledgeQueue,
    ) {}

    /** Adds a new document, queues again one whose text changed (with its new module, topic and visibility), or leaves it alone. */
    keep(source: ProfileSourceInput): Promise<ProfileSourceOutcome> {
        const { workspaceId } = source
        return this.entityManager.transaction(async (tx) => {
            const found = await tx.findOne(KnowledgeSourceEntity, {
                select: { id: true, content: true },
                where: { workspaceId, origin: source.origin, title: source.title },
                order: { createdAt: "ASC" },
                lock: { mode: "pessimistic_write" },
            })
            if (found === null) {
                const sourceId = await this.insert(tx, source)
                await this.queue.enqueueIndex({ sourceId, workspaceId }, tx)
                return "inserted"
            }
            if (found.content === source.content) return "unchanged"
            await tx.update(
                KnowledgeSourceEntity,
                { id: found.id, workspaceId },
                { status: "queued", progress: 0, error: null, content: source.content, updatedAt: NOW },
            )
            await tx.update(
                KnowledgeSourceEntity,
                { id: found.id, workspaceId },
                metaChanges({
                    title: null,
                    topic: source.topic,
                    tags: null,
                    module: source.module ?? "",
                    visibility: source.visibility,
                }),
            )
            await this.queue.enqueueIndex({ sourceId: found.id, workspaceId }, tx, this.clock.now().getTime())
            return "requeued"
        })
    }

    /** Every text document of the workspace that carries an origin, oldest first, read page by page (a copy of the workspace needs all of them). */
    async textDocuments(workspaceId: string): Promise<ReadonlyArray<ProfileDocument>> {
        const found = await this.documentsAfter(workspaceId, null, [])
        return [...found].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    }

    private async documentsAfter(
        workspaceId: string,
        after: string | null,
        kept: Array<ProfileDocument>,
    ): Promise<Array<ProfileDocument>> {
        const rows = await this.entityManager.find(KnowledgeSourceEntity, {
            select: {
                id: true,
                origin: true,
                title: true,
                topic: true,
                module: true,
                visibility: true,
                content: true,
                createdAt: true,
            },
            where: {
                workspaceId,
                kind: "text",
                origin: Not(IsNull()),
                ...(after === null ? {} : { id: MoreThan(after) }),
            },
            order: { id: "ASC" },
            take: DOCUMENT_PAGE,
        })
        const documents = rows.flatMap((row): ReadonlyArray<ProfileDocument> =>
            row.origin === null ? [] : [{ ...row, origin: row.origin }],
        )
        kept.push(...documents)
        const last = rows.at(-1)
        return rows.length < DOCUMENT_PAGE || last === undefined
            ? kept
            : this.documentsAfter(workspaceId, last.id, kept)
    }

    private async insert(tx: EntityManager, source: ProfileSourceInput): Promise<string> {
        const inserted = await tx.insert(KnowledgeSourceEntity, {
            workspaceId: source.workspaceId,
            module: source.module,
            installationId: null,
            kind: "text",
            topic: source.topic,
            tags: [],
            visibility: source.visibility,
            title: source.title,
            content: source.content,
            status: "queued",
            progress: 0,
            storagePath: null,
            sourceUrl: null,
            origin: source.origin,
            createdBy: source.ownerId,
        })
        const [row] = inserted.identifiers
        if (typeof row?.id !== "string")
            throw new KnowledgeSourcesError({ code: KnowledgeSourcesErrorCode.SourceNotFound })
        return row.id
    }
}
