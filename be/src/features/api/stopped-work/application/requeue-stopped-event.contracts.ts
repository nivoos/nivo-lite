/** What sending a buried event back takes: the workspace and the event. */
export interface RequeueStoppedEventRequest {
    /** The workspace of the event; the caller must own it. */
    readonly workspaceId: string
    /** The consumer queue that buried it. */
    readonly queue: string
    /** The stable id of the event. */
    readonly eventId: string
}
