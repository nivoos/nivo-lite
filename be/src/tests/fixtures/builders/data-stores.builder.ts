import type { DataEntry, JsonValue } from "@modules/integrations/seed"
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

/** A directory over a map from a natural key to the workspace it names. */
export class MemoryWorkspaceDirectory implements WorkspaceDirectory {
    constructor(private readonly known: Readonly<Record<string, WorkspaceRef>>) {}

    /** The workspace the key names, or null. */
    resolve(natural: string): Promise<WorkspaceRef | null> {
        return Promise.resolve(this.known[natural] ?? null)
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
