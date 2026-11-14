import { Injectable, Optional } from "@nestjs/common"
import type { JsonValue } from "@modules/integrations/seed"
import {
    KnowledgeSourcesService,
    ProfileSourcesService,
    firstPartIdOf,
    type ProfileDocument,
} from "@modules/domain/knowledge-sources"
import type { DoorRow, MaybeDoorRow, SetDoor, WorkspaceRef } from "./data-stores.contracts"
import {
    KNOWLEDGE_SET,
    knowledgeKeyOf,
    knowledgeKeyParts,
    recordObjectOf,
    type JsonRecord,
    type KnowledgeKeyParts,
} from "./data-stores.policy"
import { DataStoresError, DataStoresErrorCode } from "./errors/data-stores.error"

/** A document record whose members are of the types the set holds. */
interface KnowledgeRecord {
    /** The text. */
    readonly content: string
    /** The module that reads it; null = every module. */
    readonly module: string | null
    /** The topic label (empty = none). */
    readonly topic: string
    /** Who may read it. */
    readonly visibility: "public" | "internal"
}

/** The record a document is exported as. */
const recordOf = (document: ProfileDocument): JsonValue => ({
    content: document.content,
    module: document.module,
    topic: document.topic ?? "",
    visibility: document.visibility,
})

/** The document rows of a listing by key: a part of a long document is not held, and the oldest row of a key is the one kept. */
const rowsOf = (documents: ReadonlyArray<ProfileDocument>): ReadonlyArray<DoorRow> => {
    const rows = new Map<string, DoorRow>()
    for (const document of documents) {
        const key = knowledgeKeyOf(document.origin, document.title)
        if (firstPartIdOf(document.origin) === null && !rows.has(key))
            rows.set(key, { key, id: document.id, record: recordOf(document) })
    }
    return [...rows.values()]
}

/** The record as the set holds it, or null when a member is missing or of another type. */
const knowledgeRecordOf = (members: JsonRecord): KnowledgeRecord | null => {
    const { content, module, topic, visibility } = members
    if (typeof content !== "string" || typeof topic !== "string") return null
    if (module !== null && typeof module !== "string") return null
    if (visibility !== "public" && visibility !== "internal") return null
    return { content, module, topic, visibility }
}

/** The text of a record that is held already, or null when none is. */
const heldContentOf = (held: MaybeDoorRow): unknown => (held === null ? null : recordObjectOf(held.record)?.content)

@Injectable()
/**
 * The set `knowledge`: the text documents of the workspace's knowledge door, found by origin and title exactly as `ProfileSourcesService`
 * finds them (the key is the origin, percent-encoded so it holds no slash, then `/`, then the title). Members: `content`, `module`
 * (null = every module), `topic`, `visibility`. Only text documents with an origin are held; uploaded files, links, FAQs and the later parts of a
 * long document are not (an upload has no origin to name it). A changed text goes through `keep` (the row is updated in place and
 * queued for indexing again); a change of topic, module or visibility alone goes through `KnowledgeSourcesService.updateSource`, which
 * moves the passages with it, and is refused where the app has no such service.
 */
export class KnowledgeSourcesDoor implements SetDoor {
    readonly set: string = KNOWLEDGE_SET

    constructor(
        private readonly profiles: ProfileSourcesService,
        @Optional() private readonly sources?: KnowledgeSourcesService,
    ) {}

    /** The workspace's text documents with an origin, the oldest row of a key when two share it. */
    async list(workspace: WorkspaceRef): Promise<ReadonlyArray<DoorRow>> {
        return rowsOf(await this.profiles.textDocuments(workspace.id))
    }

    /** Keeps the document: a new row, a changed text updated in place, or a metadata-only change through the knowledge service. */
    async write(workspace: WorkspaceRef, key: string, record: JsonValue, held: MaybeDoorRow): Promise<string> {
        const parts = knowledgeKeyParts(key)
        const members = recordObjectOf(record)
        const document = members === null ? null : knowledgeRecordOf(members)
        if (parts === null || document === null) throw new DataStoresError({ code: DataStoresErrorCode.RecordInvalid })
        if (heldContentOf(held) === document.content) await this.changeMeta(workspace, held, document)
        else await this.keepText(workspace, parts, document)
        return held?.id ?? (await this.idOf(workspace, key))
    }

    /** Keeps a new or a changed text; the row is queued for indexing again. */
    private async keepText(
        workspace: WorkspaceRef,
        parts: KnowledgeKeyParts,
        document: KnowledgeRecord,
    ): Promise<void> {
        await this.profiles.keep({
            workspaceId: workspace.id,
            ownerId: workspace.ownerId,
            origin: parts.origin,
            title: parts.title,
            ...document,
        })
    }

    /** Changes topic, module or visibility of a held document through the knowledge service, which moves its passages with it. */
    private async changeMeta(workspace: WorkspaceRef, held: MaybeDoorRow, document: KnowledgeRecord): Promise<void> {
        if (this.sources === undefined) throw new DataStoresError({ code: DataStoresErrorCode.KnowledgeMetaDoor })
        await this.sources.updateSource(workspace.ownerId, workspace.id, {
            sourceId: held?.id ?? "",
            topic: document.topic,
            module: document.module ?? "",
            visibility: document.visibility,
        })
    }

    /** The id of the row a key names now (a new document has none until it is kept). */
    private async idOf(workspace: WorkspaceRef, key: string): Promise<string> {
        const row = (await this.list(workspace)).find((listed) => listed.key === key)
        if (row === undefined) throw new DataStoresError({ code: DataStoresErrorCode.RecordInvalid })
        return row.id
    }
}
