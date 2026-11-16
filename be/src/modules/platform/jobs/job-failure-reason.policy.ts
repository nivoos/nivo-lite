import { redactString } from "@modules/platform/logging"
import { isRecord } from "@modules/platform/primitives"
import { QueueError, QueueErrorCode } from "@modules/platform/queue"

/** The longest reason a job row and its dead-letter item keep. */
const REASON_MAX = 500

/** How deep the `cause` chain of a failure is followed (a wrapper of a wrapper is the deepest the stores and clients make). */
const CAUSE_DEPTH = 5

/** A CODED failure: an error with a string code and its text parameters (the error base of any package, whichever copy built it). */
interface CodedFailure {
    readonly code: string
    readonly params: Readonly<Record<string, unknown>>
    readonly cause?: unknown
}

const isCoded = (value: unknown): value is Error & CodedFailure =>
    value instanceof Error && typeof Reflect.get(value, "code") === "string" && isRecord(Reflect.get(value, "params"))

/**
 * The STABLE CODE of a failure, for a reader that maps it (a request's fault): the reason a flow failure names, else the coded error's
 * code; undefined for an uncoded throw (its words are no code).
 */
export const failureCodeOf = (cause: unknown): string | undefined => {
    if (cause instanceof QueueError && cause.code === QueueErrorCode.FlowFailure) {
        const named = cause.params.reason
        if (typeof named === "string" && named !== "") return named
    }
    return isCoded(cause) ? cause.code : undefined
}

/** The words of one link of a failure's chain: a coded one by its class and code, an uncoded throw by its class, its own code and message. */
const linkOf = (link: Error): string => {
    if (isCoded(link)) return `${link.name} ${link.code}`
    const code: unknown = Reflect.get(link, "code")
    const coded = typeof code === "string" || typeof code === "number" ? ` ${String(code)}` : ""
    return `${link.name}${coded}: ${link.message}`
}

/**
 * The failures a failure WRAPS (its `cause` chain), outermost first, each by `linkOf`, ending at the first uncoded throw (its words say
 * what went wrong; nothing under it is read) or where the chain ends.
 */
const wrappedOf = (cause: unknown, depth = 0): ReadonlyArray<string> => {
    if (depth > CAUSE_DEPTH || !(cause instanceof Error)) return []
    const words = linkOf(cause)
    return isCoded(cause) ? [words, ...wrappedOf(cause.cause, depth + 1)] : [words]
}

/**
 * THE REASON a job row and its dead-letter item keep for a failure (general rule: a failure a person must act on is NAMED). The coded
 * head (`failureCodeOf`: a flow failure's named reason, else the code) and every failure it WRAPS down to the first uncoded throw: a
 * coded one by class and code, the uncoded throw (a driver's, a client's, a store adapter's) by class, code and message, e.g.
 * `DATA_STORE_FAILED (QueryFailedError 42501: permission denied for table records)` or
 * `DATA_STORE_FAILED (DataStoresError DATA_STORES_SCOPE_REQUIRED)`; an uncoded throw on its own is its class, code and message. Never a secret: the text is scrubbed
 * by the platform's one credential redaction before it is kept. Bounded.
 */
export const failureReasonOf = (cause: unknown): string => {
    const head = failureCodeOf(cause)
    const wrapped = isCoded(cause) ? wrappedOf(cause.cause) : []
    const text =
        head === undefined
            ? cause instanceof Error
                ? linkOf(cause)
                : String(cause)
            : wrapped.length === 0
              ? head
              : `${head} (${wrapped.join(" <- ")})`
    return redactString(text).slice(0, REASON_MAX)
}
