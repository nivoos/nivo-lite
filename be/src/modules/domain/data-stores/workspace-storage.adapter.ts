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
import {
    DataRefusalCode,
    FILES_SET,
    WORKSPACE_SCOPE,
    fullKeyOf,
    mediaOf,
    workspaceKeyParts,
} from "./data-stores.policy"
import { countWritten, eachEntryInOrder, readInTurn, refuseKey, reportOf, tallyOf } from "./data-entries.policy"
import { DataStoresError, DataStoresErrorCode } from "./errors/data-stores.error"

/** One import into the storage store, being run: where it writes, what it counted and which keys the entries named. */
interface StorageRun {
    /** The one workspace a scoped call names, or null for an unscoped import (every entry names its workspace by key prefix). */
    readonly only: string | null
    /** The options of the import call. */
    readonly options: ImportOptions
    /** What the import counted, by set. */
    readonly tallies: Map<string, ImportTally>
    /** The keys of the file set the entries named, by the workspace they were written into. */
    readonly named: Map<string, Set<string>>
}

/** An entry's key placed: the workspace it is written into and the key inside it. */
interface Placed {
    /** The workspace id. */
    readonly workspaceId: string
    /** The key inside the workspace. */
    readonly key: string
}

/**
 * The files of ONE workspace in the object store as a store of the data standard: blobs keyed by the object key relative to the
 * workspace's prefix, so no workspace id enters a scoped copy. `identityOf` is the object's own full key (an object store has no other id).
 * Import writes an object only when its content or content type differs, and deletes nothing except in mirror mode.
 *
 * A call that names NO workspace is the whole deployment (a project-level backup): export lists every live workspace's objects in
 * workspace id order with the key prefixed `<workspace id>/<key>` (so the key byte order holds across workspaces); import reads the prefix
 * and writes into that workspace, and a key whose prefix names no live workspace is a refused key. The workspace id is the stable key of an
 * unscoped copy because such a copy is restored only into the same environment, where the ids are the same. A workspace that holds no
 * file, or whose bucket does not exist yet, exports nothing: an empty export is a valid one.
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

    /** Every object of the workspace (without a scope: of every live workspace), in key byte order, each read when the consumer asks for it. */
    async *export(selection: Selection): AsyncIterable<DataEntry> {
        if (selection.sets !== undefined && !selection.sets.includes(FILES_SET)) return
        const only = await this.onlyOf(selection.scope)
        const spaces = only === null ? await this.allWorkspaceIds() : [only]
        const items: Array<ExportedObject> = []
        await eachInOrder(spaces, async (workspaceId) => {
            const keys = [...(await this.objects.keys(workspaceId))].sort(byteOrder)
            items.push(...keys.map((key) => ({ workspaceId, key, entryKey: only === null ? fullKeyOf(workspaceId, key) : key })))
        })
        yield* readInTurn(items, (item) => this.entryOf(item))
    }

    /** Puts the entries into the workspace when their content or type differs; never deletes unless `mirror`. */
    async import(entries: AsyncIterable<DataEntry>, options: ImportOptions): Promise<ImportReport> {
        const only = await this.onlyOf(options.scope)
        const run: StorageRun = { only, options, tallies: new Map(), named: new Map() }
        let sawFiles = false
        await eachEntryInOrder(entries, (entry) => {
            sawFiles = sawFiles || entry.set === FILES_SET
            return this.take(run, entry)
        })
        if (options.mode === "mirror" && sawFiles)
            await eachInOrder([...run.named].sort(([left], [right]) => byteOrder(left, right)), ([workspaceId, keys]) =>
                this.mirror(run, workspaceId, keys),
            )
        return reportOf(run.tallies)
    }

    /** The full object key of a held object (`<workspace id>/<key>`), or null when none is there. */
    async identityOf(set: string, key: string): Promise<MaybeIdentity> {
        if (set !== FILES_SET) return null
        const only = await this.onlyOf(undefined)
        const placed = only === null ? await this.partsOf(key) : { workspaceId: only, key }
        if (placed === null) return null
        return (await this.objects.exists(placed.workspaceId, placed.key))
            ? fullKeyOf(placed.workspaceId, placed.key)
            : null
    }

    /** The workspace and the key inside it an unscoped key names, or null when its prefix names no live workspace. */
    private async partsOf(prefixed: string): Promise<Placed | null> {
        const parts = workspaceKeyParts(prefixed)
        const workspace = parts === null ? null : await this.directory.byId(parts.workspaceId)
        return parts === null || workspace === null ? null : { workspaceId: workspace.id, key: parts.key }
    }

    /** Where an entry is written: the one workspace of a scoped call, else the live workspace its key prefix names (null when none). */
    private placeOf(run: StorageRun, entryKey: string): Promise<Placed | null> {
        return run.only === null
            ? this.partsOf(entryKey)
            : Promise.resolve({ workspaceId: run.only, key: entryKey })
    }

    /** The ids of every live workspace, in the byte order of their key prefix. */
    private async allWorkspaceIds(): Promise<ReadonlyArray<string>> {
        const ids = (await this.directory.all()).map((workspace) => workspace.id)
        return ids.sort((left, right) => byteOrder(fullKeyOf(left, ""), fullKeyOf(right, "")))
    }

    /** The entry of one object, or null when it vanished since the keys were listed. */
    private async entryOf(item: ExportedObject): Promise<DataEntry | null> {
        const object = await this.objects.read(item.workspaceId, item.key)
        return object === null ? null : blobEntry(FILES_SET, item.entryKey, object.bytes, mediaOf(object.mime))
    }

    /** Takes one entry: refuses it, counts it as unchanged, or writes the object. */
    private async take(run: StorageRun, entry: DataEntry): Promise<void> {
        const count = tallyOf(run.tallies, entry.set)
        if (entry.set !== FILES_SET) {
            refuseKey(count, entry.key, DataRefusalCode.SetUnknown)
            return
        }
        const placed = await this.placeOf(run, entry.key)
        if (placed === null) {
            refuseKey(count, entry.key, DataRefusalCode.WorkspaceUnknown)
            return
        }
        const named = run.named.get(placed.workspaceId) ?? new Set<string>()
        run.named.set(placed.workspaceId, named.add(placed.key))
        if (entry.form !== "blob") {
            refuseKey(count, entry.key, DataRefusalCode.FormMismatch)
            return
        }
        if (!entryIntact(entry)) {
            refuseKey(count, entry.key, DataRefusalCode.EntryCorrupt)
            return
        }
        const current = await this.objects.read(placed.workspaceId, placed.key)
        if (current !== null && sha256Hex(current.bytes) === entry.sha256 && current.mime === entry.media) {
            count.unchanged += 1
            return
        }
        if (!run.options.dryRun)
            await this.objects.write(placed.workspaceId, placed.key, { bytes: entry.body, mime: entry.media })
        countWritten(count, current)
    }

    /** Removes (or, in a dry run, only counts) the objects the entries did not name. */
    private async mirror(run: StorageRun, workspaceId: string, named: ReadonlySet<string>): Promise<void> {
        const count = tallyOf(run.tallies, FILES_SET)
        const lacking = [...(await this.objects.keys(workspaceId))].filter((key) => !named.has(key)).sort(byteOrder)
        await eachInOrder(lacking, async (key) => {
            if (!run.options.dryRun) await this.objects.remove(workspaceId, key)
            count.removed += 1
        })
    }

    /** The id of the one workspace the call's scope (else the bound scope) names, or null when it names none (the whole deployment). */
    private async onlyOf(scope: StoreScope | undefined): Promise<string | null> {
        const natural = scope?.[WORKSPACE_SCOPE] ?? this.bound[WORKSPACE_SCOPE]
        if (natural === undefined) return null
        const found = await this.directory.resolve(natural)
        if (found === null) throw new DataStoresError({ code: DataStoresErrorCode.ScopeUnknown })
        return found.id
    }
}

/** One object of an export: where it is read and the key its entry carries. */
interface ExportedObject {
    /** The workspace the object lives in. */
    readonly workspaceId: string
    /** The key inside the workspace. */
    readonly key: string
    /** The key of the entry (prefixed with the workspace id in an unscoped export). */
    readonly entryKey: string
}
