/** The stream cursor of the routes (public.customer_routes `consumed_seq`, `read_seq`, `read_by`; rule QB-P5 C-4). No raw SQL. */
export interface StreamCursorStore {
    /**
     * Notes a read of the route's stream by a call (`by`: the read's call key) that returned person lines up to `seq` (bigint as text): it
     * becomes the route's pending read; the same call reading again keeps the newest; another call replaces it. False for no live route.
     */
    noteRead(workspaceId: string, routeId: string, by: string, seq: string): Promise<boolean>
    /**
     * Folds every pending read whose call key starts with `prefix` (a step's `<run>:<step>:`) into its route's cursor (the greater of the
     * two) and clears it. Answers how many routes moved.
     */
    consume(workspaceId: string, prefix: string): Promise<number>
    /** The route's cursor (bigint as text), or null while no run consumed it (or no live route has the id). */
    cursorOf(workspaceId: string, routeId: string): Promise<string | null>
}

/** The injection token of the stream cursor store. */
export const STREAM_CURSOR_STORE: unique symbol = Symbol("STREAM_CURSOR_STORE")
