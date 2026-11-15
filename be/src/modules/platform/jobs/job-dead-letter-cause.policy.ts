import { QueueError, QueueErrorCode } from "@modules/platform/queue"
import { failureCodeOf } from "./job-failure-reason.policy"

/** What the runner tells a processor's `onFailed` about the dead letter: the class of the failure and the reason it parked with. */
export interface DeadLetterCause {
    /** The class `classifyFailure` gave the failure. */
    readonly failureClass: "transient" | "input" | "code" | "config"
    /**
     * The dead letter's own reason, for a person (`failureReasonOf`): the coded head with its parameters and the uncoded throw under it
     * (class, code, message), scrubbed and bounded. Words to read, not a code to map: a reader that maps reads `code`.
     */
    readonly reason: string
    /** The stable code of the failure (the reason a flow failure named, else the coded error's code); undefined for an uncoded throw. */
    readonly code?: string | undefined
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
    const code = failureCodeOf(cause.cause)
    return { failureClass, reason, failure: cause.cause, ...(code === undefined ? {} : { code }) }
}
