import { QueueError, QueueErrorCode } from "@modules/platform/queue"

/** What the runner tells a processor's `onFailed` about the dead letter: the class of the failure and the reason it parked with. */
export interface DeadLetterCause {
    /** The class `classifyFailure` gave the failure. */
    readonly failureClass: "transient" | "input" | "code" | "config"
    /** The reason the thrower named, else the failure's code, else its message (bounded); the dead letter's own reason. */
    readonly reason: string
    /** The failure itself as the work threw it (a domain error with its params), when the runner kept it; undefined otherwise. */
    readonly failure?: unknown
}

/** The dead letter a processor's `onFailed` was handed, or undefined when the value is not one. */
export type OptionalDeadLetterCause = DeadLetterCause | undefined

/**
 * The dead letter a runner handed to `onFailed` (a flow failure whose params name the class and the reason); undefined for any other
 * value, which a processor reads as "no reason known". Reads typed fields only: nothing of the words is judged.
 */
export const deadLetterCauseOf = (cause: unknown): OptionalDeadLetterCause => {
    if (!(cause instanceof QueueError) || cause.code !== QueueErrorCode.FlowFailure) return undefined
    const { failureClass, reason } = cause.params
    if (typeof reason !== "string") return undefined
    if (failureClass !== "transient" && failureClass !== "input" && failureClass !== "code" && failureClass !== "config") return undefined
    return { failureClass, reason, failure: cause.cause }
}
