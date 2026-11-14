import { TextDecoder } from "node:util"
import { parseJsonText } from "@modules/platform/primitives"

/** One default-message frame received over the wire: the event id (undefined when the event carried none) and the parsed payload. */
export interface JobProgressReceived {
    /** The `id:` field of the event, or undefined when it was absent or empty. */
    readonly id: string | undefined
    /** The parsed `data:` payload, still unknown until a proof checks it. */
    readonly data: unknown
}

/** The caller and the chains of one job-progress subscription. */
export interface JobProgressStreamOptions {
    /** Omitted to prove the default-deny behaviour of the authentication guard. */
    readonly principalId?: string
    /** The workspace the request selects. */
    readonly workspaceId: string
    /** One chain root; with neither this nor `roots` the stream is the whole workspace. */
    readonly root?: string
    /** Several chain roots on the one connection (sent as the comma separated `roots` query). */
    readonly roots?: ReadonlyArray<string>
    /** A raw `roots` query value, for proving a malformed one is refused. */
    readonly rawRoots?: string
    /** A reconnect supplies the last frame received, through Last-Event-ID. */
    readonly after?: string
}

/** A real fetch client of the job-progress event stream. */
export interface JobProgressStreamClient {
    /** The response status. */
    readonly status: number
    /** Every default-message frame received so far, in wire order. */
    readonly received: ReadonlyArray<JobProgressReceived>
    /** Aborts the request and waits until the reader ended; safe to call again. */
    readonly disconnect: () => Promise<void>
}

/** The id field of one wire block, undefined when absent or empty. */
const idOf = (block: string): string | undefined => {
    const line = block.split("\n").find((one) => one.startsWith("id:"))
    const value = line?.slice(3).trim()
    return value === undefined || value === "" ? undefined : value
}

/** The default-message frame of one wire block, or undefined for a comment-only block. */
const receivedOf = (block: string): JobProgressReceived | undefined => {
    const data = block.split("\n").filter((line) => line.startsWith("data:"))
    if (data.length === 0) return undefined
    const text = data.map((line) => line.slice(5).trim()).join("\n")
    const parsed = parseJsonText(text)
    return { id: idOf(block), data: parsed.ok ? parsed.value : text }
}

/** Reads the body to its end, pushing every complete block's frame; an abort ends the read. */
const readFrames = async (body: ReadableStream<Uint8Array>, received: Array<JobProgressReceived>): Promise<void> => {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let pending = ""
    try {
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
            pending += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n")
            for (let end = pending.indexOf("\n\n"); end >= 0; end = pending.indexOf("\n\n")) {
                const frame = receivedOf(pending.slice(0, end))
                if (frame !== undefined) received.push(frame)
                pending = pending.slice(end + 2)
            }
        }
    } catch {
        // the client left: an aborted read is the end of the stream, not a failure of the door
    }
}

/** Opens the stream the way a browser does: principal and workspace headers, the chain(s) in the query, an optional Last-Event-ID. */
export const openJobProgressStream = async (
    origin: string,
    options: JobProgressStreamOptions,
): Promise<JobProgressStreamClient> => {
    const abort = new AbortController()
    const url = new URL("/realtime/job-progress", origin)
    if (options.root !== undefined) url.searchParams.set("root", options.root)
    if (options.roots !== undefined) url.searchParams.set("roots", options.roots.join(","))
    if (options.rawRoots !== undefined) url.searchParams.set("roots", options.rawRoots)
    const response = await fetch(url, {
        signal: abort.signal,
        headers: {
            accept: "text/event-stream",
            "x-workspace-id": options.workspaceId,
            ...(options.principalId === undefined ? {} : { "x-principal": options.principalId }),
            ...(options.after === undefined ? {} : { "last-event-id": options.after }),
        },
    })
    const received: Array<JobProgressReceived> = []
    const reading = response.body !== null && response.status === 200 ? readFrames(response.body, received) : Promise.resolve()
    return {
        status: response.status,
        received,
        disconnect: async () => {
            abort.abort()
            await reading
        },
    }
}
