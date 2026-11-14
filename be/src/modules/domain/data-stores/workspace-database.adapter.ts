import {
    byteOrder,
    recordEntry,
    recordValue,
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
    DatabaseRun,
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
import { DataRefusalCode, WORKSPACE_SCOPE, schemaOf } from "./data-stores.policy"
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

    /** Every record of the selected sets of the scope's workspace, in (set, key) byte order. */
    async *export(selection: Selection): AsyncIterable<DataEntry> {
        const workspace = await this.workspaceOf(selection.scope)
        const wanted = this.sortedDoors().filter(
            ([set]) => selection.sets === undefined || selection.sets.includes(set),
        )
        const listed = await Promise.all(wanted.map(async ([set, door]) => ({ set, rows: await door.list(workspace) })))
        for (const { set, rows } of listed) {
            for (const row of [...rows].sort((left, right) => byteOrder(left.key, right.key)))
                yield recordEntry(set, row.key, row.record)
        }
    }

    /** Upserts the entries into the scope's workspace by natural key; see the class comment. */
    async import(entries: AsyncIterable<DataEntry>, options: ImportOptions): Promise<ImportReport> {
        const run: DatabaseRun = {
            workspace: await this.workspaceOf(options.scope),
            options,
            tallies: new Map(),
            held: new Map(),
            named: new Map(),
        }
        await eachEntryInOrder(entries, (entry) => this.take(run, entry))
        if (options.mode === "mirror") await eachInOrder([...run.named], ([set, keys]) => this.mirror(run, set, keys))
        return reportOf(run.tallies)
    }

    /** The id the app's own table gives the row a key names, or null when there is none. */
    async identityOf(set: string, key: string): Promise<MaybeIdentity> {
        const door = this.doors.get(set)
        if (door === undefined) return null
        const workspace = await this.workspaceOf(undefined)
        return (await door.list(workspace)).find((row) => row.key === key)?.id ?? null
    }

    /** Takes one entry: refuses it, counts it, or writes it through its set's door. */
    private async take(run: DatabaseRun, entry: DataEntry): Promise<void> {
        const count = tallyOf(run.tallies, entry.set)
        const door = this.doors.get(entry.set)
        if (door === undefined) {
            refuseKey(count, entry.key, DataRefusalCode.SetUnknown)
            return
        }
        run.named.set(entry.set, (run.named.get(entry.set) ?? new Set()).add(entry.key))
        const refusal = recordRefusalOf(entry)
        if (refusal !== null) {
            refuseKey(count, entry.key, refusal)
            return
        }
        const current = (await this.rowsOf(run, door)).get(entry.key) ?? null
        if (current !== null && recordEntry(entry.set, entry.key, current.record).sha256 === entry.sha256)
            count.unchanged += 1
        else if (run.options.dryRun) countWritten(count, current)
        else await this.write(run, door, entry, current)
    }

    /** Writes the entry through the door and counts it; a refusal of the door is reported by key and code, any other failure goes on to the caller. */
    private async write(run: DatabaseRun, door: SetDoor, entry: DataEntry, current: MaybeDoorRow): Promise<void> {
        const count = tallyOf(run.tallies, entry.set)
        try {
            const record = recordValue(entry)
            const id = await door.write(run.workspace, entry.key, record, current)
            const rows = await this.rowsOf(run, door)
            rows.set(entry.key, { key: entry.key, id, record })
            countWritten(count, current)
        } catch (error) {
            const code = refusalCodeOf(error)
            if (code === null) throw error
            refuseKey(count, entry.key, code)
        }
    }

    /** The rows a door holds, listed once for the whole import. */
    private async rowsOf(run: DatabaseRun, door: SetDoor): Promise<HeldRows> {
        const known = run.held.get(door.set)
        if (known !== undefined) return known
        const rows: HeldRows = new Map((await door.list(run.workspace)).map((row) => [row.key, row]))
        run.held.set(door.set, rows)
        return rows
    }

    /** Removes (where the set has a removing door) or reports the held keys of one named set that the entries did not name. */
    private async mirror(run: DatabaseRun, set: string, named: ReadonlySet<string>): Promise<void> {
        const door = this.doors.get(set)
        if (door === undefined) return
        const count = tallyOf(run.tallies, set)
        const rows = await this.rowsOf(run, door)
        const lacking = [...rows].filter(([key]) => !named.has(key)).sort(([left], [right]) => byteOrder(left, right))
        await eachInOrder(lacking, ([key, row]) => this.removeRow(run, door, count, key, row))
    }

    /** Removes one row through its door, or reports it when the set has no removing door. */
    private async removeRow(
        run: DatabaseRun,
        door: SetDoor,
        count: ImportTally,
        key: string,
        row: DoorRow,
    ): Promise<void> {
        if (door.remove === undefined) {
            refuseKey(count, key, DataRefusalCode.NotRemovable)
            return
        }
        if (!run.options.dryRun) await door.remove(run.workspace, row)
        count.removed += 1
    }

    private sortedDoors(): ReadonlyArray<readonly [string, SetDoor]> {
        return [...this.doors].sort(([left], [right]) => byteOrder(left, right))
    }

    /** The workspace the call's scope (else the bound scope) names. */
    private async workspaceOf(scope: StoreScope | undefined): Promise<WorkspaceRef> {
        const natural = scope?.[WORKSPACE_SCOPE] ?? this.bound[WORKSPACE_SCOPE]
        if (natural === undefined) throw new DataStoresError({ code: DataStoresErrorCode.ScopeRequired })
        const found = await this.directory.resolve(natural)
        if (found === null) throw new DataStoresError({ code: DataStoresErrorCode.ScopeUnknown })
        return found
    }
}
