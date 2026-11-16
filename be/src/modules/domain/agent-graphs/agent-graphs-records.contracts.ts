import type { JsonValue } from "@nivo-lite/agent-sdk/schema"
import type { GraphChangeKind, GraphMode } from "./agent-graphs.contracts"

/** A plain JSON object as a record stores it. */
export type PlainJson = { readonly [key: string]: JsonValue }

/** The graph of one agent as its record stores it; `fence` is the record version every write names. */
export interface GraphRecord {
    /** The record. */
    readonly id: string
    /** The workspace. */
    readonly workspaceId: string
    /** The record version a write must still find. */
    readonly fence: string
    /** The agent. */
    readonly agentId: string
    /** The installation the agent runs as. */
    readonly installationId: string
    /** The draft the editor changes, not yet parsed with the document schema. */
    readonly draft: object
    /** The revision of the draft. */
    readonly draftRev: number
    /** The version that decides, or null before the first. */
    readonly activeVersionId: string | null
    /** Whether the graph decides or only records. */
    readonly mode: GraphMode
    /** The owner who last set the mode, or null. */
    readonly modeSetBy: string | null
    /** When they did, or null. */
    readonly modeSetAt: Date | null
}

/** A graph found or made, and whether this call made it. */
export interface EnsuredGraph {
    /** The graph. */
    readonly graph: GraphRecord
    /** True when this call inserted it. */
    readonly created: boolean
}

/** One frozen version of a graph as its record stores it. */
export interface VersionRecord {
    /** The record, which is the version id. */
    readonly id: string
    /** The workspace. */
    readonly workspaceId: string
    /** The agent. */
    readonly agentId: string
    /** The number of the version within the agent. */
    readonly number: number
    /** The frozen graph, not yet parsed with the document schema. */
    readonly document: object
    /** The hash of the document. */
    readonly documentHash: string
    /** The context version it was published with, or null. */
    readonly contextVersionId: string | null
    /** How it came to be. */
    readonly changeKind: GraphChangeKind
    /** A note of the publisher. */
    readonly note: string
    /** Who published it, or null. */
    readonly publishedBy: string | null
    /** When it was published. */
    readonly publishedAt: Date
}

/** A graph as `ensureGraph` writes it when the agent has none. */
export interface GraphInsert {
    /** The agent. */
    readonly agentId: string
    /** The installation the agent runs as. */
    readonly installationId: string
    /** The first draft. */
    readonly draft: PlainJson
    /** The revision of the draft. */
    readonly draftRev: number
    /** Whether the graph decides or only records. */
    readonly mode: GraphMode
}

/** The members of a graph a write changes; an absent member is left as it is. */
export interface GraphPatch {
    /** The draft. */
    readonly draft?: PlainJson
    /** The revision of the draft. */
    readonly draftRev?: number
    /** The version that decides. */
    readonly activeVersionId?: string | null
    /** Whether the graph decides or only records. */
    readonly mode?: GraphMode
    /** The owner who set the mode. */
    readonly modeSetBy?: string | null
    /** When they did (ISO text). */
    readonly modeSetAt?: string | null
}

/** A version as `insertVersion` writes it; `publishedAt` absent is the moment of the write. */
export interface VersionInsert {
    /** The agent. */
    readonly agentId: string
    /** The number of the version within the agent. */
    readonly number: number
    /** The frozen graph. */
    readonly document: PlainJson
    /** The hash of the document. */
    readonly documentHash: string
    /** The context version it was published with, or null. */
    readonly contextVersionId: string | null
    /** How it came to be. */
    readonly changeKind: GraphChangeKind
    /** A note of the publisher. */
    readonly note: string
    /** Who published it, or null. */
    readonly publishedBy: string | null
    /** When it was published (ISO text). */
    readonly publishedAt?: string
}

