import type { ImportOptions, JsonValue, RefusedKey } from "@modules/integrations/seed"

/** The workspace a store call works inside: its id and the person who owns it (the creator a door records). */
export interface WorkspaceRef {
    /** The workspace id; never part of an entry. */
    readonly id: string
    /** The owner of the workspace. */
    readonly ownerId: string
}

/** A workspace found by a natural key, or none. */
export type MaybeWorkspaceRef = WorkspaceRef | null

/** Finds the workspace a scope names by its natural key. */
export interface WorkspaceDirectory {
    /** The workspace of an enterprise identifier, else the one live workspace of that name; null when none or several. */
    resolve(natural: string): Promise<MaybeWorkspaceRef>
    /** Every live workspace, in workspace id order (none: an environment with no workspace yet). */
    all(): Promise<ReadonlyArray<WorkspaceRef>>
    /** The live workspace with this id, or null when none (also for a text that is no id). */
    byId(workspaceId: string): Promise<MaybeWorkspaceRef>
}

/** One row a set door holds: its natural key, its own id and its record. */
export interface DoorRow {
    /** The natural key, unique in the set. */
    readonly key: string
    /** The id the app's own table gives the row. */
    readonly id: string
    /** The record as the set exports it: natural keys only, no database id or workspace id. */
    readonly record: JsonValue
}

/** A held row of a set, or none. */
export type MaybeDoorRow = DoorRow | null

/**
 * The door of ONE set of a workspace's foundation rows: how its rows are listed, written and (when the set allows it) removed, through
 * the module that owns them. A door never builds SQL text; it speaks to the module's service.
 */
export interface SetDoor {
    /** The set name (kebab-case). */
    readonly set: string
    /** Every row of the workspace, in any order; each key once. */
    list(workspace: WorkspaceRef): Promise<ReadonlyArray<DoorRow>>
    /**
     * Writes one record under its key: `held` is the row already there (update it in place, it keeps its id) or null (create it).
     * Answers the row's id. A member the record does not carry stays as it is. Throws a `DomainError` with a code for a record the set
     * refuses; anything else is a failure the caller's job runner judges.
     */
    write(workspace: WorkspaceRef, key: string, record: JsonValue, held: MaybeDoorRow): Promise<string>
    /** Removes a row; absent when the module has no door that removes it (a mirror then reports the key). */
    readonly remove?: (workspace: WorkspaceRef, row: DoorRow) => Promise<void>
}

/** The narrowing a store call works inside: the natural key of each member (`workspace`: the enterprise identifier or the name). */
export interface StoreScope {
    /** The natural key of one member of the scope. */
    readonly [member: string]: string
}

/** The store's own identity of a row or an object, or none. */
export type MaybeIdentity = string | null

/** What an import counted for one set. */
export interface ImportTally {
    /** Entries the store created. */
    created: number
    /** Entries the store updated in place. */
    updated: number
    /** Entries equal to what is held. */
    unchanged: number
    /** Entries a mirror removed. */
    removed: number
    /** The keys refused, each with its code. */
    refused: Array<RefusedKey>
}

/** The tallies of an import, by set. */
export type ImportTallies = Map<string, ImportTally>

/** One stored object as the storage store reads it. */
export interface WorkspaceObject {
    /** The bytes. */
    readonly bytes: Uint8Array
    /** The content type the store recorded. */
    readonly mime: string
}

/** A stored object, or none. */
export type MaybeWorkspaceObject = WorkspaceObject | null

/**
 * The files of ONE workspace in the object store, by key RELATIVE to the workspace's prefix (the store keys every object
 * `<workspaceId>/<relative key>`). A missing object answers null; a store that cannot be reached THROWS (the runner judges it).
 */
export interface WorkspaceObjects {
    /** Every relative key the workspace holds. */
    keys(workspaceId: string): Promise<ReadonlyArray<string>>
    /** The object at a relative key, or null when there is none. */
    read(workspaceId: string, key: string): Promise<MaybeWorkspaceObject>
    /** Whether an object is there, without reading it. */
    exists(workspaceId: string, key: string): Promise<boolean>
    /** Writes the object, replacing an earlier one at the key. */
    write(workspaceId: string, key: string, object: WorkspaceObject): Promise<void>
    /** Removes the object; a missing one is not an error. */
    remove(workspaceId: string, key: string): Promise<void>
}

/** The rows of one set a door holds, by key. */
export type HeldRows = Map<string, DoorRow>

/** What an import into the database store works with inside ONE workspace: what its doors hold and what the entries named. */
export interface DatabaseWork {
    /** The workspace the entries are written into. */
    readonly workspace: WorkspaceRef
    /** True for an unscoped import: the keys the copy reports carry the workspace id prefix. */
    readonly prefixed: boolean
    /** The rows each door held, listed once per set. */
    readonly held: Map<string, HeldRows>
    /** The keys the entries named, by set. */
    readonly named: Map<string, Set<string>>
}

/** One import into the database store, being run: where it writes, what it counted and the work of each workspace it reached. */
export interface DatabaseRun {
    /** The one workspace a scoped call names, or null for an unscoped import (every entry names its own workspace by key prefix). */
    readonly only: WorkspaceRef | null
    /** The options of the import call. */
    readonly options: ImportOptions
    /** What the import counted, by set. */
    readonly tallies: ImportTallies
    /** The work of each workspace the entries reached, by workspace id. */
    readonly works: Map<string, DatabaseWork>
}
