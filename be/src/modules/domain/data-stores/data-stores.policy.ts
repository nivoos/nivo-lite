import { setSchemaOf, type EntryForm, type Inability, type JsonValue } from "@modules/integrations/seed"
import { attempt, isRecord } from "@modules/platform/primitives"
import type { DataStoreConsole } from "./data-stores.options"

/** The format of the records NIVO's database store keeps; every record set is `nivo-seed-standard/<set>@1`. */
export const RECORD_FORMAT = "nivo-seed-standard@1"

/** The schema id of a set of the given form. */
export const schemaOf = (set: string, form: EntryForm): string => setSchemaOf(RECORD_FORMAT, set, form)

/** The key of the `workspace` set: the one row of the scope's workspace. */
export const WORKSPACE_ROW_KEY = "settings"

/** The scope member that names the workspace. */
export const WORKSPACE_SCOPE = "workspace"

/** The set of the workspace's settings. */
export const WORKSPACE_SET = "workspace"

/** The set of the workspace's text documents. */
export const KNOWLEDGE_SET = "knowledge"

/** The one set the storage store holds: the objects of the workspace's records bucket. */
export const FILES_SET = "record-files"

/** Content type of an object the store recorded none for. */
const DEFAULT_MEDIA = "application/octet-stream"

/** The content type an object is exported with: the one the store recorded, else the default. */
export const mediaOf = (mime: string): string => (mime === "" ? DEFAULT_MEDIA : mime)

/** The refusal codes an import reports for a key; never a value. */
export enum DataRefusalCode {
    /** The set is not one the store holds. */
    SetUnknown = "DATA_SET_UNKNOWN",
    /** The entry is not of the form its set holds. */
    FormMismatch = "DATA_FORM_MISMATCH",
    /** The entry body does not match its sha256. */
    EntryCorrupt = "DATA_ENTRY_CORRUPT",
    /** The set has no door that removes a row: a mirror cannot remove this key. */
    NotRemovable = "DATA_SET_NOT_REMOVABLE",
    /** An unscoped import entry's key names no live workspace in its prefix (`<workspace id>/<key>`). */
    WorkspaceUnknown = "DATA_WORKSPACE_UNKNOWN",
}

/** What the database store says it cannot do, each with its reason. */
export const DATABASE_CANNOT: ReadonlyArray<Inability> = [
    {
        what: "export and import of set records",
        reason:
            "a record of the entity engine has only a uuid and an owning agent, no natural key; inventing one would break the rule that " +
            "an import keeps identity, so no set of records is held until the entity declarations name a stable business key",
    },
    {
        what: "export and import of set connection-credentials",
        reason:
            "connection credentials are sealed by the app key and never leave in clear; they are exported only by the seed-standard " +
            "export of SEED-REPO",
    },
    {
        what: "export of the workspace logo address and billing facts",
        reason:
            "the logo address is an environment's public URL (the picture itself is a file), and billing, plan and enterprise identifier " +
            "are operational data a seed never overwrites",
    },
]

/** What the storage store says it cannot do. */
export const STORAGE_CANNOT: ReadonlyArray<Inability> = [
    {
        what: "export of files of the media and knowledge-uploads buckets",
        reason: "only the records bucket keys every object by its workspace first; the other buckets are held by their own features",
    },
    {
        what: "export of objects no record references",
        reason: "the object storage port lists one folder level only, so the keys are found from the workspace's records and its staged folder",
    },
]

/** A JSON object: the shape of the record of an entry. */
export type JsonRecord = { readonly [key: string]: JsonValue }

/** True when a value is a JSON object (not null, not an array). */
export const isJsonRecord = (value: JsonValue): value is JsonRecord => isRecord(value) && !Array.isArray(value)

/** The record of an entry as a JSON object, or null when the body is not one. */
export const recordObjectOf = (value: JsonValue): JsonRecord | null => (isJsonRecord(value) ? value : null)

/** The key of a knowledge document: its origin (percent-encoded, so it holds no slash) and its title. */
export const knowledgeKeyOf = (origin: string, title: string): string => `${encodeURIComponent(origin)}/${title}`

/** The origin and title a knowledge key names. */
export interface KnowledgeKeyParts {
    /** The origin of the document. */
    readonly origin: string
    /** The title of the document. */
    readonly title: string
}

/** The origin and title a knowledge key names, or null when the key is not one. */
export const knowledgeKeyParts = (key: string): KnowledgeKeyParts | null => {
    const slash = key.indexOf("/")
    if (slash <= 0 || slash === key.length - 1) return null
    const origin = attempt(() => decodeURIComponent(key.slice(0, slash)))
    return origin.ok ? { origin: origin.value, title: key.slice(slash + 1) } : null
}

/** The full key of a relative key: `<workspaceId>/<key>`. */
export const fullKeyOf = (workspaceId: string, key: string): string => `${workspaceId}/${key}`

/** A workspace id as the database writes it: a uuid, so it can never hold a slash and is safe to ask the database about. */
const WORKSPACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

/** True when a text has the shape of a workspace id. */
export const isWorkspaceId = (value: string): boolean => WORKSPACE_ID.test(value)

/** A key of an unscoped copy split into its workspace id and the key inside the workspace. */
export interface WorkspaceKeyParts {
    /** The workspace id the prefix names (not yet known to be a live workspace). */
    readonly workspaceId: string
    /** The key inside the workspace. */
    readonly key: string
}

/** The workspace id and the key an unscoped copy's key (`<workspace id>/<key>`) names, or null when the key has no such prefix. */
export const workspaceKeyParts = (prefixed: string): WorkspaceKeyParts | null => {
    const slash = prefixed.indexOf("/")
    if (slash <= 0 || slash === prefixed.length - 1) return null
    const workspaceId = prefixed.slice(0, slash)
    return isWorkspaceId(workspaceId) ? { workspaceId, key: prefixed.slice(slash + 1) } : null
}

/** The console of an app that serves no store over it: no input, output discarded. */
export const NO_CONSOLE: DataStoreConsole = {
    lines: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }),
    print: () => undefined,
    exit: () => undefined,
}
