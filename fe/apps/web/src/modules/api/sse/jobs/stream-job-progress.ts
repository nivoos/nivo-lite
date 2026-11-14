import { isJobProgressFrame, type JobProgressFrame, type JobProgressSelector } from "@/modules/jobProgress"
import { eventStreamUrl } from "@/modules/config"
import { openWorkspaceId } from "@/modules/routes"
import type { EventStreamHandle } from "@starci/event-stream"
import { eventStream, type StreamReporter } from "../clients/event-stream"

/** One event of the stream as the follower hands it over: the frame, or null when the event was not one. */
interface JobProgressEvent {
    readonly data: JobProgressFrame | null
}

/** What following the progress of one chain of jobs takes. */
interface StreamJobProgressParams {
    /** The chains to follow on this one stream: by name (`<kind>:<id>`, for example `knowledge-source:<id>`, 1 to 50), or every chain of the workspace. */
    readonly selector: JobProgressSelector
    /** Stops the stream and its reconnects. */
    readonly signal: AbortSignal
    /** Called each time the stream (re)opens: read the stored state once, which closes the gap since the last frame. */
    readonly onOpen: () => void
    /** Called for each frame. */
    readonly onFrame: (frame: JobProgressFrame) => void
    /** Where a refused or broken attempt is reported. */
    readonly report?: StreamReporter
}

/** The frame of one event, or null when its data is not JSON or not a frame (the event is then ignored). */
const frameOf = (data: string): JobProgressFrame | null => {
    try {
        const frame: unknown = JSON.parse(data)
        return isJobProgressFrame(frame) ? frame : null
    } catch {
        return null
    }
}

/** The path of the door for the chains asked: `?roots=a,b,c` for a list, nothing for every chain of the workspace. */
const queryPathOf = (selector: JobProgressSelector): string =>
    selector.kind === "all"
        ? "/realtime/job-progress"
        : `/realtime/job-progress?roots=${selector.roots.map((root) => encodeURIComponent(root)).join(",")}`

/**
 * Follows the progress of the chains of jobs in view on ONE connection (`GET /realtime/job-progress?roots=...`, or no selector for the
 * whole workspace) until the signal aborts: first the current state of each job (with its retry time), then the live frames, each
 * naming its chain; the shared client reconnects with `Last-Event-ID`.
 */
export const streamJobProgress = ({
    selector,
    signal,
    onOpen,
    onFrame,
    report,
}: StreamJobProgressParams): EventStreamHandle => {
    const workspaceId = openWorkspaceId()
    const headers: Record<string, string> = {}
    if (workspaceId !== undefined) headers["x-workspace-id"] = workspaceId
    return eventStream.follow<JobProgressFrame | null>(
        eventStreamUrl(queryPathOf(selector)),
        {
            signal,
            headers,
            parse: frameOf,
            onOpen,
            onFrame: ({ data }: JobProgressEvent) => (data === null ? undefined : onFrame(data)),
            onError: (error: Error) => report?.(`[event stream] ${error.message}`),
        },
    )
}
