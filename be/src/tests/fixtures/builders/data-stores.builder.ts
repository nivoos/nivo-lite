import type { DataEntry, JsonValue } from "@modules/integrations/seed"
import type { BucketObjectHead, StorageBucketsPort } from "@modules/integrations/object-storage"
import {
    DataStoresError,
    DataStoresErrorCode,
    type DoorRow,
    type SetDoor,
    type WorkspaceDirectory,
    type WorkspaceObject,
    type WorkspaceObjects,
    type WorkspaceRef,
} from "@modules/domain/data-stores"

export { storeContract } from "@modules/integrations/seed"

/** The objects a memory workspace store starts with: by workspace id, by relative key. */
export interface ObjectSeed {
    /** The objects of one workspace, by relative key. */
    readonly [workspaceId: string]: Readonly<Record<string, WorkspaceObject>>
}

/** A set door over a plain map: ids are minted on create and kept on update; a `remove` door exists only when asked for. */
export class MemorySetDoor implements SetDoor {
    private readonly rows = new Map<string, DoorRow>()
    private next = 0
    /** Keys whose write the door refuses, with the error the door raises. */
    readonly refuse: Map<string, DataStoresError> = new Map()
    readonly remove?: (workspace: WorkspaceRef, row: DoorRow) => Promise<void>

    constructor(
        readonly set: string,
        seed: Readonly<Record<string, JsonValue>> = {},
        removable = false,
    ) {
        for (const [key, record] of Object.entries(seed)) this.put(key, record)
        if (removable) {
            this.remove = (_workspace, row) => {
                this.rows.delete(row.key)
                return Promise.resolve()
            }
        }
    }

    /** Every row the door holds. */
    list(): Promise<ReadonlyArray<DoorRow>> {
        return Promise.resolve([...this.rows.values()])
    }

    /** Keeps a record under its key unless the key is one the door was told to refuse. */
    async write(_workspace: WorkspaceRef, key: string, record: JsonValue, held: DoorRow | null): Promise<string> {
        await Promise.resolve()
        const refusal = this.refuse.get(key)
        if (refusal !== undefined) throw refusal
        if (typeof record !== "object" || record === null)
            throw new DataStoresError({ code: DataStoresErrorCode.RecordInvalid })
        return this.put(key, record, held?.id)
    }

    private put(key: string, record: JsonValue, id?: string): string {
        this.next += 1
        const kept = id ?? this.rows.get(key)?.id ?? `row-${String(this.next)}`
        this.rows.set(key, { key, id: kept, record: structuredClone(record) })
        return kept
    }
}

/** A directory over a map from a natural key to the workspace it names; every distinct workspace of the map is a live one (by id). */
export class MemoryWorkspaceDirectory implements WorkspaceDirectory {
    constructor(private readonly known: Readonly<Record<string, WorkspaceRef>>) {}

    /** The workspace the key names, or null. */
    resolve(natural: string): Promise<WorkspaceRef | null> {
        return Promise.resolve(this.known[natural] ?? null)
    }

    /** Every live workspace, in id order. */
    all(): Promise<ReadonlyArray<WorkspaceRef>> {
        const byId = new Map(Object.values(this.known).map((workspace) => [workspace.id, workspace]))
        return Promise.resolve([...byId.values()].sort((left, right) => (left.id < right.id ? -1 : 1)))
    }

    /** The live workspace of an id, or null. */
    async byId(workspaceId: string): Promise<WorkspaceRef | null> {
        return (await this.all()).find((workspace) => workspace.id === workspaceId) ?? null
    }
}

/** A set door that keeps each workspace's rows apart (one `MemorySetDoor` per workspace id), for the calls that reach several workspaces. */
export class WorkspaceSetDoor implements SetDoor {
    private readonly doors = new Map<string, MemorySetDoor>()

    constructor(
        readonly set: string,
        private readonly seed: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {},
    ) {}

    /** The rows of one workspace. */
    list(workspace: WorkspaceRef): Promise<ReadonlyArray<DoorRow>> {
        return this.doorOf(workspace).list()
    }

    /** Writes one record into the workspace's door. */
    write(workspace: WorkspaceRef, key: string, record: JsonValue, held: DoorRow | null): Promise<string> {
        return this.doorOf(workspace).write(workspace, key, record, held)
    }

    private doorOf(workspace: WorkspaceRef): MemorySetDoor {
        const known = this.doors.get(workspace.id) ?? new MemorySetDoor(this.set, this.seed[workspace.id] ?? {})
        this.doors.set(workspace.id, known)
        return known
    }
}

/** The workspace objects over a map keyed `<workspaceId>/<key>`, with every call it served recorded. */
export class MemoryWorkspaceObjects implements WorkspaceObjects {
    private readonly stored = new Map<string, WorkspaceObject>()
    /** The calls served, `<verb> <workspace>/<key>`, in order. */
    readonly calls: Array<string> = []

    constructor(seed: ObjectSeed = {}) {
        for (const [workspaceId, objects] of Object.entries(seed)) {
            for (const [key, object] of Object.entries(objects)) this.stored.set(`${workspaceId}/${key}`, object)
        }
    }

    /** The relative keys the workspace holds. */
    keys(workspaceId: string): Promise<ReadonlyArray<string>> {
        const prefix = `${workspaceId}/`
        return Promise.resolve(
            [...this.stored.keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)),
        )
    }

    /** The object at a relative key, or null. */
    read(workspaceId: string, key: string): Promise<WorkspaceObject | null> {
        this.calls.push(`read ${workspaceId}/${key}`)
        return Promise.resolve(this.stored.get(`${workspaceId}/${key}`) ?? null)
    }

    /** Whether an object is there. */
    exists(workspaceId: string, key: string): Promise<boolean> {
        return Promise.resolve(this.stored.has(`${workspaceId}/${key}`))
    }

    /** Stores a copy of the object. */
    write(workspaceId: string, key: string, object: WorkspaceObject): Promise<void> {
        this.calls.push(`write ${workspaceId}/${key}`)
        this.stored.set(`${workspaceId}/${key}`, { bytes: object.bytes.slice(), mime: object.mime })
        return Promise.resolve()
    }

    /** Removes the object. */
    remove(workspaceId: string, key: string): Promise<void> {
        this.calls.push(`remove ${workspaceId}/${key}`)
        this.stored.delete(`${workspaceId}/${key}`)
        return Promise.resolve()
    }
}

/** Collects the entries of a stream into a list. */
export const collectEntries = async (entries: AsyncIterable<DataEntry>): Promise<ReadonlyArray<DataEntry>> => {
    const out: Array<DataEntry> = []
    for await (const entry of entries) out.push(entry)
    return out
}

/** A stream of the given entries. */
export async function* entriesFrom(entries: ReadonlyArray<DataEntry>): AsyncIterable<DataEntry> {
    await Promise.resolve()
    yield* entries
}

/** The objects an owned bucket starts with: by set, by key. */
export interface BucketSeed {
    /** The objects of one bucket, by key. */
    readonly [set: string]: Readonly<Record<string, WorkspaceObject>>
}

const byteOrderOf = (left: string, right: string): number => Buffer.compare(Buffer.from(left), Buffer.from(right))

/** The owned buckets over a map, with every call recorded: a bucket that does not exist is empty, and a write creates it. */
export class MemoryStorageBuckets implements StorageBucketsPort {
    private readonly stored = new Map<string, Map<string, WorkspaceObject>>()
    /** The calls served, `<verb> <set>/<key>`, in order. */
    readonly calls: Array<string> = []

    constructor(
        private readonly owned: ReadonlyArray<string>,
        seed: BucketSeed = {},
    ) {
        for (const [set, objects] of Object.entries(seed)) this.stored.set(set, new Map(Object.entries(objects)))
    }

    /** The owned sets. */
    sets(): ReadonlyArray<string> {
        return this.owned
    }

    /** The next keys after `after` in byte order. */
    keys(set: string, after: string, limit: number): Promise<ReadonlyArray<string>> {
        this.calls.push(`keys ${set}/${after}`)
        const keys = [...(this.stored.get(set)?.keys() ?? [])].sort(byteOrderOf)
        return Promise.resolve(keys.filter((key) => after === "" || byteOrderOf(key, after) > 0).slice(0, limit))
    }

    /** The size and content type of an object. */
    head(set: string, key: string): Promise<BucketObjectHead | null> {
        const found = this.stored.get(set)?.get(key)
        return Promise.resolve(found === undefined ? null : { size: found.bytes.byteLength, contentType: found.mime })
    }

    /** The bytes and content type of an object. */
    read(set: string, key: string): Promise<{ readonly bytes: Uint8Array; readonly contentType: string } | null> {
        this.calls.push(`read ${set}/${key}`)
        const found = this.stored.get(set)?.get(key)
        return Promise.resolve(found === undefined ? null : { bytes: found.bytes, contentType: found.mime })
    }

    /** Stores a copy of the object, creating the bucket. */
    write(set: string, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
        this.calls.push(`write ${set}/${key}`)
        const objects = this.stored.get(set) ?? new Map<string, WorkspaceObject>()
        objects.set(key, { bytes: bytes.slice(), mime: contentType })
        this.stored.set(set, objects)
        return Promise.resolve()
    }
}
