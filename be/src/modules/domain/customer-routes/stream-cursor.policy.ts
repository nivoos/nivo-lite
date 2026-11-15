import type { CustomerLine } from "./customer-line-store.port"

/*
 * THE STREAM CURSOR (rule QB-P5 C-4), the pure half. A position of the stream is a line's insertion order (`customer_messages.seq`, a bigint
 * handed as decimal text). A read records the newest PERSON line it returned; the end of the step that read folds it into the cursor.
 */

/** The name of the lines stream (concept agent-data): its subject is the route; the other engine streams are named by their record type. */
export const LINES_STREAM = "lines"

/** True when the decimal text `left` is a greater position than `right` (both non-negative integers, no sign, no leading zeros needed). */
export const seqAfter = (left: string, right: string): boolean => {
    const [a, b] = [left.replace(/^0+(?=\d)/u, ""), right.replace(/^0+(?=\d)/u, "")]
    return a.length === b.length ? a > b : a.length > b.length
}

/** The newest position among the person's lines of a read (the lines the read handed out), or null when it handed out none. */
export const newestHeardSeqOf = (lines: ReadonlyArray<Pick<CustomerLine, "direction" | "seq">>): string | null =>
    lines
        .filter((line) => line.direction === "from_person")
        .reduce<string | null>((newest, line) => (newest === null || seqAfter(line.seq, newest) ? line.seq : newest), null)

/**
 * The call-key prefix of every call one step of a run makes (the host keys a step's calls `<run>:<step>:<digest>`): what the end of that step
 * folds. The trailing separator keeps step `a` from folding step `ab`'s read.
 */
export const stepCallPrefixOf = (runId: string, stepKey: string): string => `${runId}:${stepKey}:`

/** True when a call key is one of the step's calls. */
export const isStepCall = (callKey: string, runId: string, stepKey: string): boolean => callKey.startsWith(stepCallPrefixOf(runId, stepKey))
