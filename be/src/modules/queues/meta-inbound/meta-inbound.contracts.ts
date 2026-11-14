/**
 * One inbound Meta delivery waiting on the queue: the connection and workspace it belongs to, and the normalised event the receipt kept.
 * The queue reads only the event's key (the once key of the job); the domain that wrote the event narrows it again to read it.
 */
export interface MetaInboundPayload {
    /** The connection that owns the Page or Instagram account. */
    readonly connectionId: string
    /** The workspace of the connection. */
    readonly workspaceId: string
    /** The normalised event, as the meta integration parsed it. */
    readonly event: { readonly event_key: string }
}

/** True when a job payload is the payload of an accept-meta-event job. */
export const isMetaInboundPayload = (value: unknown): value is MetaInboundPayload =>
    typeof value === "object" &&
    value !== null &&
    "connectionId" in value &&
    typeof value.connectionId === "string" &&
    "workspaceId" in value &&
    typeof value.workspaceId === "string" &&
    "event" in value &&
    typeof value.event === "object" &&
    value.event !== null &&
    "event_key" in value.event &&
    typeof value.event.event_key === "string"
