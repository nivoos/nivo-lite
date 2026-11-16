import {
    blobEntry,
    byteOrder,
    entryIntact,
    sha256Hex,
    type DataEntry,
    type ImportOptions,
    type ImportReport,
    type Inability,
    type Selection,
    type StoreAdapter,
    type StoreDescription,
} from "@modules/integrations/seed"
import type { BucketObjectHead, StorageBucketsPort } from "@modules/integrations/object-storage"
import type { ImportTallies, MaybeIdentity } from "./data-stores.contracts"
import { DataRefusalCode, mediaOf } from "./data-stores.policy"
import { countWritten, eachEntryInOrder, readInTurn, refuseKey, reportOf, tallyOf } from "./data-entries.policy"
import { DataStoresError, DataStoresErrorCode } from "./errors/data-stores.error"

/** The store id of every object of every bucket the deployment owns. */
export const STORAGE_ALL_STORE_ID = "storage-all"

/** Keys one listing page holds while an export walks a bucket. */
const KEYS_PER_PAGE = 500

/** What the whole-deployment storage store says it cannot do. */
export const STORAGE_ALL_CANNOT: ReadonlyArray<Inability> = [
    {
        what: "a narrowing scope and a mirror import",
        reason:
            "the store is the whole deployment: a scope names a workspace it does not know, and a mirror would delete objects the copy does " +
            "not name; a restore only creates and updates objects",
    },
    {
        what: "versions of an object",
        reason: "an object is held as its latest bytes and content type; the object store keeps no history the copy could name",
    },
]

/**
 * EVERY object of EVERY bucket the deployment owns as a store of the data standard (the backup of the whole deployment's files): one blob
 * set per bucket, named by the bucket WITHOUT its environment prefix, the entry key being the object key and the media its content type.
 * An empty or missing bucket is an empty set. Import puts an object only when it is missing, its content type differs or its bytes differ
 * (the size is compared first, then the sha256), and creates the bucket when it is missing; it never deletes. `identityOf` is the object's
 * set and key, because an object store has no other identity.
 */
export class StorageAllStore implements StoreAdapter {
    readonly id: string = STORAGE_ALL_STORE_ID
    readonly kind: StoreAdapter["kind"] = "storage"
    readonly level: StoreAdapter["level"] = "logical"

    constructor(private readonly buckets: StorageBucketsPort) {}

    /** One blob set per owned bucket, and what the store cannot do. */
    describe(): Promise<StoreDescription> {
        return Promise.resolve({
            sets: this.setNames().map((set) => ({ set, schema: "blob@1", form: "blob" })),
            purposes: ["seed-backup"],
            canExport: true,
            canImport: true,
            cannot: STORAGE_ALL_CANNOT,
        })
    }

    /** Every object of the selected buckets, in (set, key) byte order; each object is read when the consumer asks for it. */
    async *export(selection: Selection): AsyncIterable<DataEntry> {
        this.refuseNarrowing(selection.scope)
        for (const set of this.selected(selection.sets)) yield* this.exportSet(set, "")
    }

    /** Puts the entries whose content or type differs; never deletes. */
    async import(entries: AsyncIterable<DataEntry>, options: ImportOptions): Promise<ImportReport> {
        this.refuseNarrowing(options.scope)
        if (options.mode === "mirror") throw new DataStoresError({ code: DataStoresErrorCode.CallUnsupported })
        const tallies: ImportTallies = new Map()
        const owned = new Set(this.setNames())
        await eachEntryInOrder(entries, (entry) => this.take(tallies, owned, entry, options.dryRun))
        return reportOf(tallies)
    }

    /** The entries of one bucket after the key `after`: one page of keys, then the pages after its last key. */
    private async *exportSet(set: string, after: string): AsyncIterable<DataEntry> {
        const keys = await this.buckets.keys(set, after, KEYS_PER_PAGE)
        yield* readInTurn([...keys].sort(byteOrder), (key) => this.entryOf(set, key))
        const last = keys.at(-1)
        if (last !== undefined) yield* this.exportSet(set, last)
    }

    /** The entry of one object, or null when it vanished since the keys were listed. */
    private async entryOf(set: string, key: string): Promise<DataEntry | null> {
        const object = await this.buckets.read(set, key)
        return object === null ? null : blobEntry(set, key, object.bytes, mediaOf(object.contentType))
    }

    /** The object's own place (`<set>/<key>`), or null when it is not there. */
    async identityOf(set: string, key: string): Promise<MaybeIdentity> {
        if (!this.setNames().includes(set)) return null
        return (await this.buckets.head(set, key)) === null ? null : `${set}/${key}`
    }

    /** Takes one entry: refuses it, counts it as unchanged, or writes the object. */
    private async take(tallies: ImportTallies, owned: ReadonlySet<string>, entry: DataEntry, dryRun: boolean): Promise<void> {
        const count = tallyOf(tallies, entry.set)
        if (!owned.has(entry.set)) {
            refuseKey(count, entry.key, DataRefusalCode.SetUnknown)
            return
        }
        if (entry.form !== "blob") {
            refuseKey(count, entry.key, DataRefusalCode.FormMismatch)
            return
        }
        if (!entryIntact(entry)) {
            refuseKey(count, entry.key, DataRefusalCode.EntryCorrupt)
            return
        }
        const held = await this.buckets.head(entry.set, entry.key)
        if (held !== null && (await this.sameObject(entry, held))) {
            count.unchanged += 1
            return
        }
        if (!dryRun) await this.buckets.write(entry.set, entry.key, entry.body, entry.media)
        countWritten(count, held)
    }

    /** Whether the held object has the entry's content type and bytes: the size and type are compared first, the bytes only when they agree. */
    private async sameObject(entry: DataEntry, held: BucketObjectHead): Promise<boolean> {
        if (held.size !== entry.body.byteLength || held.contentType !== entry.media) return false
        const current = await this.buckets.read(entry.set, entry.key)
        return current !== null && sha256Hex(current.bytes) === entry.sha256
    }

    /** The owned sets in byte order. */
    private setNames(): ReadonlyArray<string> {
        return [...this.buckets.sets()].sort(byteOrder)
    }

    /** The owned sets a selection names (every set when it names none), in byte order. */
    private selected(sets: ReadonlyArray<string> | undefined): ReadonlyArray<string> {
        return this.setNames().filter((set) => sets === undefined || sets.includes(set))
    }

    /** A scope narrows to a workspace this store does not know: refused, never silently ignored. */
    private refuseNarrowing(scope: Readonly<Record<string, string>> | undefined): void {
        if (scope !== undefined && Object.keys(scope).length > 0)
            throw new DataStoresError({ code: DataStoresErrorCode.CallUnsupported })
    }
}
