import { Injectable } from "@nestjs/common"
import { fileRefsOf, type FieldDef } from "@nivo-lite/agent-sdk/entity"
import { EntityEngineService, type ScopedTx } from "@modules/domain/entity-engine"
import {
    InjectStorageFiles,
    InjectStorageObjects,
    OBJECT_STORAGE_ERROR_CODES,
    type StorageFilesPort,
    type StorageObjectsPort,
} from "@modules/integrations/object-storage"
import { eachInOrder, type Outcome } from "@modules/platform/primitives"
import type { MaybeWorkspaceObject, WorkspaceObject, WorkspaceObjects } from "./data-stores.contracts"
import { fullKeyOf } from "./data-stores.policy"
import { DataStoresError, DataStoresErrorCode } from "./errors/data-stores.error"

/** The purpose of the one bucket every record file lives in (`<prefix>-records`). */
const RECORDS_BUCKET = "records"

/** The folder of the objects a tool produced before they sit on a record. */
const STAGED_FOLDER = "staged"

/** The most staged objects one listing reads. */
const STAGED_MAX = 10_000

/** Records read per page when the keys are collected. */
const PAGE = 100

/** A file field of a record type: its name and its declaration. */
type FileField = readonly [string, FieldDef]

/** One page of the records of one type that hold files, being read: where it stands and what it found. */
interface FilePageRead {
    /** The transaction of the engine scope the reads run under. */
    readonly tx: ScopedTx
    /** The record type. */
    readonly entity: string
    /** The file fields of the type. */
    readonly fields: ReadonlyArray<FileField>
    /** The prefix of the workspace's keys, `<workspaceId>/`. */
    readonly prefix: string
    /** The relative keys found so far. */
    readonly found: Set<string>
}

@Injectable()
/**
 * The workspace's files in the one records bucket, through the app's own storage doors (`StorageFilesPort` for the bytes,
 * `StorageObjectsPort` for the staged folder). The object store lists one folder level only, so the keys are found from where the app
 * itself records them: every `file` field of every live record of the workspace (read through the entity engine's own list, under the
 * engine scope, as every record read is), and the staged folder. An object no record names and that is not staged is not found; the
 * storage store says so in `cannot`.
 */
export class RecordFilesWorkspaceObjects implements WorkspaceObjects {
    constructor(
        @InjectStorageFiles() private readonly files: StorageFilesPort,
        @InjectStorageObjects() private readonly objects: StorageObjectsPort,
        private readonly engine: EntityEngineService,
    ) {}

    /** The relative keys of the workspace's record files and staged objects. */
    async keys(workspaceId: string): Promise<ReadonlyArray<string>> {
        const listed = await this.objects.list(RECORDS_BUCKET, `${workspaceId}/${STAGED_FOLDER}`, STAGED_MAX)
        if (listed.kind === "refused") throw new DataStoresError({ code: DataStoresErrorCode.StorageUnavailable })
        const found = new Set(listed.value.map((file) => `${STAGED_FOLDER}/${file.name}`))
        await this.engine.scoped(workspaceId, (tx) => this.collect(tx, `${workspaceId}/`, found))
        return [...found]
    }

    /** The object at a relative key, or null. */
    async read(workspaceId: string, key: string): Promise<MaybeWorkspaceObject> {
        const found = await this.files.read(fullKeyOf(workspaceId, key))
        return found.kind === "ok"
            ? { bytes: found.value.bytes, mime: found.value.contentType }
            : this.absentOrThrow(found)
    }

    /** Whether the object is there. */
    async exists(workspaceId: string, key: string): Promise<boolean> {
        const found = await this.files.head(fullKeyOf(workspaceId, key))
        return found.kind === "ok" ? true : this.absentOrThrow(found) !== null
    }

    /** Writes the object under the workspace's prefix. */
    async write(workspaceId: string, key: string, object: WorkspaceObject): Promise<void> {
        const written = await this.files.write(fullKeyOf(workspaceId, key), object.bytes, object.mime)
        if (written.kind === "refused") throw new DataStoresError({ code: DataStoresErrorCode.StorageUnavailable })
    }

    /** Removes the object. */
    async remove(workspaceId: string, key: string): Promise<void> {
        const removed = await this.files.remove(fullKeyOf(workspaceId, key))
        if (removed.kind === "refused") throw new DataStoresError({ code: DataStoresErrorCode.StorageUnavailable })
    }

    /** Adds to `found` the relative keys every file field of every record type of the catalog names. */
    private async collect(tx: ScopedTx, prefix: string, found: Set<string>): Promise<void> {
        await eachInOrder([...this.engine.catalog.values()], async (definition) => {
            const fields = Object.entries(definition.fields).filter(([, field]) => field.kind === "file")
            if (fields.length > 0)
                await this.readPage({ tx, entity: definition.name, fields, prefix, found }, undefined)
        })
    }

    /** Reads one page of the type's records and the pages after it, adding the keys they name. */
    private async readPage(read: FilePageRead, after: string | undefined): Promise<void> {
        const query = {
            from: read.entity,
            select: read.fields.map(([name]) => name),
            order: [["id", "asc"]] as const,
            page: after === undefined ? { size: PAGE } : { size: PAGE, after },
        }
        const page = await this.engine.list(read.tx, query, `${read.prefix}${read.entity}`)
        for (const listed of page.rows) this.keep(read, listed.row.data)
        if (page.next !== null) await this.readPage(read, page.next)
    }

    /** Adds the relative keys one record's file fields name, when they lie under the workspace's prefix. */
    private keep(read: FilePageRead, data: Readonly<Record<string, unknown>>): void {
        for (const [name, field] of read.fields) {
            for (const ref of fileRefsOf(field, data[name])) {
                if (ref.key.startsWith(read.prefix)) read.found.add(ref.key.slice(read.prefix.length))
            }
        }
    }

    /** An absent object answers null (never a value to use); any other refusal is a store that did not answer. */
    private absentOrThrow(refusal: Extract<Outcome<unknown, string>, { kind: "refused" }>): null {
        if (refusal.code === OBJECT_STORAGE_ERROR_CODES.ObjectNotFound) return null
        throw new DataStoresError({ code: DataStoresErrorCode.StorageUnavailable })
    }
}
