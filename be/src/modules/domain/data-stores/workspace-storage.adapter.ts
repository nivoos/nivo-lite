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
import { eachInOrder } from "@modules/platform/primitives"
import type {
    ImportTally,
    MaybeIdentity,
    StoreScope,
    WorkspaceDirectory,
    WorkspaceObjects,
} from "./data-stores.contracts"
import { DataRefusalCode, FILES_SET, WORKSPACE_SCOPE, fullKeyOf, mediaOf } from "./data-stores.policy"
import { countWritten, eachEntryInOrder, readInTurn, refuseKey, reportOf, tallyOf } from "./data-entries.policy"
import { DataStoresError, DataStoresErrorCode } from "./errors/data-stores.error"

/** One import into the storage store, being run: where it writes, what it counted and which keys the entries named. */
interface StorageRun {
    /** The workspace whose files are written. */
    readonly workspaceId: string
    /** The options of the import call. */
    readonly options: ImportOptions
    /** What the import counted, by set. */
    readonly tallies: Map<string, ImportTally>
    /** The keys of the file set the entries named. */
    readonly named: Set<string>
}

/**
 * The files of ONE workspace in the object store as a store of the data standard: blobs keyed by the object key relative to the
 * workspace's prefix, so no workspace id enters a copy. `identityOf` is the object's own full key (an object store has no other id). Import
 * writes an object only when its content or content type differs, and deletes nothing except in mirror mode.
 */
export class WorkspaceStorageStore implements StoreAdapter {
    readonly id: string = "storage"
    readonly kind: StoreAdapter["kind"] = "storage"
    readonly level: StoreAdapter["level"] = "logical"

    constructor(
        private readonly directory: WorkspaceDirectory,
        private readonly objects: WorkspaceObjects,
        private readonly cannot: ReadonlyArray<Inability>,
        private readonly bound: StoreScope = {},
    ) {}

    /** The same store bound to a scope, for a call that names none (an identity question has no selection). */
    within(scope: StoreScope): WorkspaceStorageStore {
        return new WorkspaceStorageStore(this.directory, this.objects, this.cannot, scope)
    }

    /** The one set of blobs, and what the store cannot do. */
    describe(): Promise<StoreDescription> {
        return Promise.resolve({
            sets: [{ set: FILES_SET, schema: "blob@1", form: "blob" }],
            purposes: ["seed-standard", "seed-backup"],
            canExport: true,
            canImport: true,
            cannot: this.cannot,
        })
    }

    /** Every object of the workspace, in key byte order, each read when the consumer asks for it. */
    async *export(selection: Selection): AsyncIterable<DataEntry> {
        if (selection.sets !== undefined && !selection.sets.includes(FILES_SET)) return
        const workspaceId = await this.workspaceIdOf(selection.scope)
        const keys = [...(await this.objects.keys(workspaceId))].sort(byteOrder)
        yield* readInTurn(keys, (key) => this.entryOf(workspaceId, key))
    }

    /** Puts the entries into the workspace when their content or type differs; never deletes unless `mirror`. */
    async import(entries: AsyncIterable<DataEntry>, options: ImportOptions): Promise<ImportReport> {
        const run: StorageRun = {
            workspaceId: await this.workspaceIdOf(options.scope),
            options,
            tallies: new Map(),
            named: new Set(),
        }
        let sawFiles = false
        await eachEntryInOrder(entries, (entry) => {
            sawFiles = sawFiles || entry.set === FILES_SET
            return this.take(run, entry)
        })
        if (options.mode === "mirror" && sawFiles) await this.mirror(run)
        return reportOf(run.tallies)
    }

    /** The full object key of a held object (`<workspace id>/<key>`), or null when none is there. */
    async identityOf(set: string, key: string): Promise<MaybeIdentity> {
        if (set !== FILES_SET) return null
        const workspaceId = await this.workspaceIdOf(undefined)
        return (await this.objects.exists(workspaceId, key)) ? fullKeyOf(workspaceId, key) : null
    }

    /** The entry of one object, or null when it vanished since the keys were listed. */
    private async entryOf(workspaceId: string, key: string): Promise<DataEntry | null> {
        const object = await this.objects.read(workspaceId, key)
        return object === null ? null : blobEntry(FILES_SET, key, object.bytes, mediaOf(object.mime))
    }

    /** Takes one entry: refuses it, counts it as unchanged, or writes the object. */
    private async take(run: StorageRun, entry: DataEntry): Promise<void> {
        const count = tallyOf(run.tallies, entry.set)
        if (entry.set !== FILES_SET) {
            refuseKey(count, entry.key, DataRefusalCode.SetUnknown)
            return
        }
        run.named.add(entry.key)
        if (entry.form !== "blob") {
            refuseKey(count, entry.key, DataRefusalCode.FormMismatch)
            return
        }
        if (!entryIntact(entry)) {
            refuseKey(count, entry.key, DataRefusalCode.EntryCorrupt)
            return
        }
        const current = await this.objects.read(run.workspaceId, entry.key)
        if (current !== null && sha256Hex(current.bytes) === entry.sha256 && current.mime === entry.media) {
            count.unchanged += 1
            return
        }
        if (!run.options.dryRun)
            await this.objects.write(run.workspaceId, entry.key, { bytes: entry.body, mime: entry.media })
        countWritten(count, current)
    }

    /** Removes (or, in a dry run, only counts) the objects the entries did not name. */
    private async mirror(run: StorageRun): Promise<void> {
        const count = tallyOf(run.tallies, FILES_SET)
        const lacking = [...(await this.objects.keys(run.workspaceId))]
            .filter((key) => !run.named.has(key))
            .sort(byteOrder)
        await eachInOrder(lacking, async (key) => {
            if (!run.options.dryRun) await this.objects.remove(run.workspaceId, key)
            count.removed += 1
        })
    }

    /** The id of the workspace the call's scope (else the bound scope) names. */
    private async workspaceIdOf(scope: StoreScope | undefined): Promise<string> {
        const natural = scope?.[WORKSPACE_SCOPE] ?? this.bound[WORKSPACE_SCOPE]
        if (natural === undefined) throw new DataStoresError({ code: DataStoresErrorCode.ScopeRequired })
        const found = await this.directory.resolve(natural)
        if (found === null) throw new DataStoresError({ code: DataStoresErrorCode.ScopeUnknown })
        return found.id
    }
}
