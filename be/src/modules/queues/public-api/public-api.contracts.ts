/** The jobs of the public-api queue; the value is the job name inside the queue and the prefix of the dedupe key. */
export enum PublicApiQueueJob {
    /**
     * Carries out one request the public API accepted. The processor reads the ledger row public.public_api named by the payload: its
     * kind (lead, message or knowledge) says which work to do, its payload holds the request body, and it sets processed_at when done.
     * A knowledge source is written with the ledger id as its own id.
     */
    Request = "public-api.request",
    /**
     * Sends the reply of one accepted API message to the person's channel. The request job writes it in the transaction that commits
     * the request's processing, so a reply owed is never held only in memory; its once key is the send key of the delivery ledger.
     */
    Send = "public-api.send",
}

/** The payload of the request job: ids only (the processor re-reads the ledger row). */
export interface PublicApiRequestPayload {
    /** The ledger row of the accepted request. */
    readonly requestId: string
    /** The workspace of the key that sent the request: the workspace concurrency limit is keyed on it. */
    readonly workspaceId: string
}

/** The dedupe key of a request job: one job per ledger row, however often it is enqueued. */
export const publicApiDedupeKey = (requestId: string): string => `${PublicApiQueueJob.Request}:${requestId}`

/** The payload of the send job: the reply one accepted message owes, with ids and the exact text (the sender re-reads the contact's channel identity). */
export interface PublicMessageSendPayload {
    /** The workspace. */
    readonly workspaceId: string
    /** The once-key of the send in the delivery ledger (`api.message:<request id>`). */
    readonly sendKey: string
    /** The route (the conversation id the API names). */
    readonly routeId: string
    /** The person the route reaches. */
    readonly contactId: string
    /** The agent that tells it. */
    readonly agentId: string
    /** The channel of the route. */
    readonly channel: string
    /** The connection, site or API key of the entrance, or null. */
    readonly accountId: string | null
    /** The text to send. */
    readonly text: string
}

const SEND_TEXT_KEYS = ["workspaceId", "sendKey", "routeId", "contactId", "agentId", "channel", "text"] as const

/** True when a job payload is the payload of a send job. */
export const isPublicMessageSendPayload = (value: unknown): value is PublicMessageSendPayload => {
    if (typeof value !== "object" || value === null) return false
    const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value))
    return SEND_TEXT_KEYS.every((key) => typeof fields[key] === "string") && (fields.accountId === null || typeof fields.accountId === "string")
}

/** True when a job payload is the payload of a ledger request job. */
export const isPublicApiRequestPayload = (value: unknown): value is PublicApiRequestPayload => {
    if (typeof value !== "object" || value === null) return false
    const fields: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value))
    return typeof fields.requestId === "string" && typeof fields.workspaceId === "string"
}

/** The dedupe key of a send job: one per send key, so a repeated processing of a request adds no second send. */
export const publicMessageSendKey = (sendKey: string): string => `${PublicApiQueueJob.Send}:${sendKey}`
