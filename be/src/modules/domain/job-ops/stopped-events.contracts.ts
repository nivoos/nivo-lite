/** The most buried deliveries one consumer queue is read for, in one listing or one requeue. */
export const STOPPED_EVENTS_LIMIT = 100

/** One buried event of a workspace as its owner reads it. */
export interface StoppedEventView {
    /** The consumer queue that gave up on it (`<topic>__<consumer>`): the first half of what sends it back. */
    readonly queue: string
    /** The stable identity of the event: the second half of what sends it back, and the id the item's card carries (`event:<queue>:<eventId>`). */
    readonly eventId: string
    /** The event's name (the topic it was sent to). */
    readonly eventName: string
    /** Why it was buried: the class of the failure no retry can fix, `max-deliveries` or `malformed`. */
    readonly reason: string
    /** How many deliveries it had. */
    readonly readCount: number
}

/** What a buried delivery's envelope tells the door: the event, its name and the workspace its payload names. */
export interface EnvelopeFacts {
    /** The stable identity of the event. */
    readonly eventId: string
    /** The event's name. */
    readonly eventName: string
    /** The workspace its payload names (a uuid), or null when it names none. */
    readonly workspaceId: string | null
}
