import {
    byteOrder,
    recordEntry,
    recordValue,
    type DataEntry,
    type ImportOptions,
    type ImportReport,
    type Inability,
    type JsonValue,
    type Selection,
    type StoreAdapter,
    type StoreDescription,
} from "@modules/integrations/seed"
import { eachInOrder } from "@modules/platform/primitives"
import type {
    DatabaseRun,
    DatabaseWork,
    DoorRow,
    HeldRows,
    ImportTally,
    MaybeIdentity,
    MaybeDoorRow,
    SetDoor,
    StoreScope,
    WorkspaceDirectory,
    WorkspaceRef,
} from "./data-stores.contracts"
import {
    DataRefusalCode,
    WORKSPACE_SCOPE,
    fullKeyOf,
    schemaOf,
    workspaceKeyParts,
} from "./data-stores.policy"
import {
    countWritten,
    eachEntryInOrder,
    recordRefusalOf,
    refusalCodeOf,
    refuseKey,
    reportOf,
    tallyOf,
} from "./data-entries.policy"
import { DataStoresError, DataStoresErrorCode } from "./errors/data-stores.error"

/**
 * The foundation rows of ONE workspace as a store of the data standard: a registry of set doors (one small class per set), read and
 * written through each module's own door. Export is deterministic (sets, then keys, in UTF-8 byte order; natural keys only). Import is an
 * upsert by natural key that KEEPS the row's identity: a held key is updated in place, a key the entries do not name is left alone (a
 * mirror reports or removes it), and what an entry does not carry is never overwritten. The workspace comes from the scope of the call
 * (`scope.workspace`), or from the scope the store was bound to with `within`.
 *
 * A call that names NO workspace is the whole deployment (a project-level backup): export lists the sets of every live workspace in
 * workspace id order, each key prefixed `<workspace id>/<key>` so the (set, key) byte order holds across workspaces; import reads the
 * prefix and writes into that workspace, and a key whose prefix names no live workspace is a refused key. The workspace id is the stable
 * key of an unscoped copy because such a copy is restored only into the same environment (where the ids are the same); a scoped copy
 * (the seed standard) never carries an id.
 */
export class WorkspaceDatabaseStore implements StoreAdapter {
    readonly id: string = "database"
    readonly kind: StoreAdapter["kind"] = "database"
    readonly level: StoreAdapter["level"] = "logical"
    private readonly doors: ReadonlyMap<string, SetDoor>

    constructor(
        private readonly directory: WorkspaceDirectory,
        doors: ReadonlyArray<SetDoor>,
        private readonly cannot: ReadonlyArray<Inability>,
        private readonly bound: StoreScope = {},
    ) {
        this.doors = new Map(doors.map((door) => [door.set, door]))
    }

    /** The same store bound to a scope, for a call that names none (an identity question has no selection). */
    within(scope: StoreScope): WorkspaceDatabaseStore {
        return new WorkspaceDatabaseStore(this.directory, [...this.doors.values()], this.cannot, scope)
    }

    /** The sets it holds, what they serve, and what it cannot do. */
    describe(): Promise<StoreDescription> {
        const sets = this.sortedDoors().map(([set]) => ({
            set,
            schema: schemaOf(set, "record"),
            form: "record" as const,
        }))
        return Promise.resolve({
            sets,
            purposes: ["seed-standard", "seed-backup"],
            canExport: true,
            canImport: true,
            cannot: this.cannot,
        })
    }

    /** Every record of the selected sets of the scope's workspace (without a scope: of every live workspace), in (set, key) byte order. */
    async *export(selection: Selection): AsyncIterable<DataEntry> {
        const spaces = await this.spacesOf(selection.scope)
        const wanted = this.sortedDoors().filter(
            ([set]) => selection.sets === undefined || selection.sets.includes(set),
        )
        const listed: Array<{ readonly set: string; readonly rows: ReadonlyArray<ExportedRow> }> = []
        await eachInOrder(wanted, async ([set, door]) => {
            const rows: Array<ExportedRow> = []
            await eachInOrder(spaces, async (space) => {
                const held = [...(await door.list(space.workspace))].sort((left, right) =>
                    byteOrder(left.key, right.key),
                )
                rows.push(
                    ...held.map((row) => ({
                        key: space.prefixed ? fullKeyOf(space.workspace.id, row.key) : row.key,
                        record: row.record,
                    })),
                )
            })
            listed.push({ set, rows })
        })
        for (const { set, rows } of listed) {
            for (const row of rows) yield recordEntry(set, row.key, row.record)
        }
    }

    /** Upserts the entries into the scope's workspace by natural key; see the class comment. */
    async import(entries: AsyncIterable<DataEntry>, options: ImportOptions): Promise<ImportReport> {
        const only = await this.onlyOf(options.scope)
        const run: DatabaseRun = { only, options, tallies: new Map(), works: new Map() }
        if (only !== null) run.works.set(only.id, workOf(only, false))
        await eachEntryInOrder(entries, (entry) => this.take(run, entry))
        if (options.mode === "mirror") {
            const works = [...run.works.values()].sort((left, right) =>
                byteOrder(fullKeyOf(left.workspace.id, ""), fullKeyOf(right.workspace.id, "")),
            )
            await eachInOrder(works, (work) =>
                eachInOrder([...work.named], ([set, keys]) => this.mirror(run, work, set, keys)),
            )
        }
        return reportOf(run.tallies)
    }

    /** The id the app's own table gives the row a key names, or null when there is none. */
    async identityOf(set: string, key: string): Promise<MaybeIdentity> {
        const door = this.doors.get(set)
        if (door === undefined) return null
        const only = await this.onlyOf(undefined)
        const found = only === null ? await this.partsOf(key) : { workspace: only, key }
        if (found === null) return null
        return (await door.list(found.workspace)).find((row) => row.key === found.key)?.id ?? null
    }

    /** The workspace and the key inside it an unscoped key names, or null when its prefix names no live workspace. */
    private async partsOf(prefixed: string): Promise<Placed | null> {
        const parts = workspaceKeyParts(prefixed)
        const workspace = parts === null ? null : await this.directory.byId(parts.workspaceId)
        return parts === null || workspace === null ? null : { workspace, key: parts.key }
    }

    /** The work of the workspace an entry's key belongs to, and the key inside it; null when an unscoped key names no live workspace. */
    private async placeOf(run: DatabaseRun, entryKey: string): Promise<PlacedWork | null> {
        if (run.only !== null) {
            const only = run.works.get(run.only.id)
            return only === undefined ? null : { work: only, key: entryKey }
        }
        const found = await this.partsOf(entryKey)
        if (found === null) return null
        const known = run.works.get(found.workspace.id) ?? workOf(found.workspace, true)
        run.works.set(found.workspace.id, known)
        return { work: known, key: found.key }
    }

    /** Takes one entry: refuses it, counts it, or writes it through its set's door. */
    private async take(run: DatabaseRun, entry: DataEntry): Promise<void> {
        const count = tallyOf(run.tallies, entry.set)
        const door = this.doors.get(entry.set)
        if (door === undefined) {
            refuseKey(count, entry.key, DataRefusalCode.SetUnknown)
            return
        }
        const placed = await this.placeOf(run, entry.key)
        if (placed === null) {
            refuseKey(count, entry.key, DataRefusalCode.WorkspaceUnknown)
            return
        }
        const { work, key } = placed
        work.named.set(entry.set, (work.named.get(entry.set) ?? new Set()).add(key))
        const refusal = recordRefusalOf(entry)
        if (refusal !== null) {
            refuseKey(count, entry.key, refusal)
            return
        }
        const current = (await this.rowsOf(work, door)).get(key) ?? null
        if (current !== null && recordEntry(entry.set, key, current.record).sha256 === entry.sha256)
            count.unchanged += 1
        else if (run.options.dryRun) countWritten(count, current)
        else await this.write(run, placed, door, entry, current)
    }

    /** Writes the entry through the door and counts it; a refusal of the door is reported by key and code, any other failure goes on to the caller. */
    private async write(
        run: DatabaseRun,
        placed: PlacedWork,
        door: SetDoor,
        entry: DataEntry,
        current: MaybeDoorRow,
    ): Promise<void> {
        const count = tallyOf(run.tallies, entry.set)
        const { work, key } = placed
        try {
            const record = recordValue(entry)
            const id = await door.write(work.workspace, key, record, current)
            const rows = await this.rowsOf(work, door)
            rows.set(key, { key, id, record })
            countWritten(count, current)
        } catch (error) {
            const code = refusalCodeOf(error)
            if (code === null) throw error
            refuseKey(count, entry.key, code)
        }
    }

    /** The rows a door holds, listed once for the whole import. */
    private async rowsOf(work: DatabaseWork, door: SetDoor): Promise<HeldRows> {
        const known = work.held.get(door.set)
        if (known !== undefined) return known
        const rows: HeldRows = new Map((await door.list(work.workspace)).map((row) => [row.key, row]))
        work.held.set(door.set, rows)
        return rows
    }

    /** Removes (where the set has a removing door) or reports the held keys of one named set that the entries did not name. */
    private async mirror(run: DatabaseRun, work: DatabaseWork, set: string, named: ReadonlySet<string>): Promise<void> {
        const door = this.doors.get(set)
        if (door === undefined) return
        const count = tallyOf(run.tallies, set)
        const rows = await this.rowsOf(work, door)
        const lacking = [...rows].filter(([key]) => !named.has(key)).sort(([left], [right]) => byteOrder(left, right))
        await eachInOrder(lacking, ([key, row]) => this.removeRow(run, work, door, count, key, row))
    }

    /** Removes one row through its door, or reports it when the set has no removing door. */
    private async removeRow(
        run: DatabaseRun,
        work: DatabaseWork,
        door: SetDoor,
        count: ImportTally,
        key: string,
        row: DoorRow,
    ): Promise<void> {
        if (door.remove === undefined) {
            refuseKey(count, work.prefixed ? fullKeyOf(work.workspace.id, key) : key, DataRefusalCode.NotRemovable)
            return
        }
        if (!run.options.dryRun) await door.remove(work.workspace, row)
        count.removed += 1
    }

    private sortedDoors(): ReadonlyArray<readonly [string, SetDoor]> {
        return [...this.doors].sort(([left], [right]) => byteOrder(left, right))
    }

    /** The one workspace the call's scope (else the bound scope) names, or null when it names none (the whole deployment). */
    private async onlyOf(scope: StoreScope | undefined): Promise<WorkspaceRef | null> {
        const natural = scope?.[WORKSPACE_SCOPE] ?? this.bound[WORKSPACE_SCOPE]
        if (natural === undefined) return null
        const found = await this.directory.resolve(natural)
        if (found === null) throw new DataStoresError({ code: DataStoresErrorCode.ScopeUnknown })
        return found
    }

    /** The workspaces an export reads: the named one, else every live workspace in the byte order of their key prefix. */
    private async spacesOf(scope: StoreScope | undefined): Promise<ReadonlyArray<Space>> {
        const only = await this.onlyOf(scope)
        if (only !== null) return [{ workspace: only, prefixed: false }]
        const all = await this.directory.all()
        return all
            .map((workspace) => ({ workspace, prefixed: true }))
            .sort((left, right) => byteOrder(fullKeyOf(left.workspace.id, ""), fullKeyOf(right.workspace.id, "")))
    }
}

/** A workspace an export reads and whether its keys carry the workspace id prefix. */
interface Space {
    /** The workspace. */
    readonly workspace: WorkspaceRef
    /** True for an export of the whole deployment. */
    readonly prefixed: boolean
}

/** A row of an export as listed: the key it is exported under and its record. */
interface ExportedRow {
    /** The key of the entry. */
    readonly key: string
    /** The record. */
    readonly record: JsonValue
}

/** An entry's key placed: the work of its workspace and the key inside the workspace. */
interface PlacedWork {
    /** The work of the entry's workspace. */
    readonly work: DatabaseWork
    /** The key inside the workspace. */
    readonly key: string
}

/** A key placed: its workspace and the key inside it. */
interface Placed {
    /** The workspace. */
    readonly workspace: WorkspaceRef
    /** The key inside the workspace. */
    readonly key: string
}

/** The empty work of one workspace. */
const workOf = (workspace: WorkspaceRef, prefixed: boolean): DatabaseWork => ({
    workspace,
    prefixed,
    held: new Map(),
    named: new Map(),
})
