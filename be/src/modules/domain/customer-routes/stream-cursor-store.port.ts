/**
 * One consumer's position on one subject of one engine stream (concept agent-data rules 5, 8): the CONSUMER is an agent (its runs share
 * its position: the consumer-group model), the STREAM is `lines` (the lines of a route) or a record type declared append-only, the SUBJECT
 * is the route or the type's declared subject value.
 */
export interface StreamRef {
    readonly agentId: string
    readonly stream: string
    readonly subject: string
}

/** The stream cursors (public.stream_cursors; concept agent-data rule 9). No raw SQL. */
export interface StreamCursorStore {
    /**
     * Notes a read of a stream subject by a call (`by`: the read's call key) that returned items up to `seq` (bigint as text): it becomes
     * the consumer's pending read on that subject; the same call reading again keeps the newest; another call replaces it.
     */
    noteRead(workspaceId: string, ref: StreamRef, by: string, seq: string): Promise<void>
    /**
     * Folds every pending read whose call key starts with `prefix` (a step's `<run>:<step>:`) into its cursor (the greater of the two) and
     * clears it. Answers how many cursors moved.
     */
    consume(workspaceId: string, prefix: string): Promise<number>
    /** The consumer's cursor on the subject (bigint as text), or null while it consumed none. */
    cursorOf(workspaceId: string, ref: StreamRef): Promise<string | null>
    /**
     * A merge of two subjects into one (two contact ids merged into one person): every consumer's cursor on `from` joins its cursor on
     * `into` (the greater of the two); `from`'s rows are gone. Answers how many cursors it joined.
     */
    merge(workspaceId: string, from: string, into: string): Promise<number>
}

/** The injection token of the stream cursor store. */
export const STREAM_CURSOR_STORE: unique symbol = Symbol("STREAM_CURSOR_STORE")
