/** When the parked rows below stopped. */
export const PARKED_AT: Date = new Date("2026-02-03T03:00:00.000Z")

/** The columns of a parked job row that the person's list of stopped work reads. */
export interface ParkedJobRowFacts {
    /** The job row. */
    readonly id: string
    /** The job's name. */
    readonly kind: string
    /** The recorded class of the failure, when it names one. */
    readonly failureClass: string | null
    /** The failure code, when the row holds one. */
    readonly error: string | null
    /** When it parked. */
    readonly parkedAt: Date
    /** How many times a person handed it back. */
    readonly resumeCount: number
}

/** A parked job row as the job table holds it, with the given facts. */
const parkedRow = (
    id: string,
    kind: string,
    failureClass: string | null,
    error: string | null,
    resumeCount: number,
): ParkedJobRowFacts => ({ id, kind, failureClass, error, parkedAt: PARKED_AT, resumeCount })

/** The parked rows a spec of the person's list of stopped work reads. */
export const parkedJobRows: Readonly<Record<"unreadableSource" | "vectorStoreDown" | "unclassified", () => ParkedJobRowFacts>> = {
    /** A job that stopped on data it cannot read, handed back once by a person. */
    unreadableSource: () => parkedRow("j-1", "extract-knowledge-facts", "input", "KNOWLEDGE_SOURCE_UNREADABLE", 1),
    /** A job that stopped on an outside cause, never handed back. */
    vectorStoreDown: () => parkedRow("j-2", "sync-vectors", "transient", "QDRANT_DOWN", 0),
    /** A job whose row names neither a class nor an error. */
    unclassified: () => parkedRow("j-3", "sync-vectors", null, null, 0),
}
