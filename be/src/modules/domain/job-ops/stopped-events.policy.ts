import { workspaceOf } from "@modules/platform/queue"
import type { EnvelopeFacts } from "./stopped-events.contracts"

/**
 * What the envelope of a buried event tells: its id, its name and the workspace its payload names. Typed fields only (nothing of the
 * words is read); null for a message that is no event envelope (a malformed delivery that names nobody).
 */
export const envelopeFactsOf = (message: unknown): EnvelopeFacts | null => {
    if (typeof message !== "object" || message === null) return null
    const eventId = "eventId" in message ? message.eventId : undefined
    const eventName = "eventName" in message ? message.eventName : undefined
    if (typeof eventId !== "string" || eventId === "" || typeof eventName !== "string") return null
    const payload = "payload" in message ? message.payload : undefined
    const workspaceId = typeof payload === "object" && payload !== null ? workspaceOf(payload) : null
    return { eventId, eventName, workspaceId }
}
