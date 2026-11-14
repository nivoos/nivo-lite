import type { JobProgressView } from "./jobProgress.state"

/** The tone of a badge. */
type JobStateTone = "neutral" | "warning" | "success"

/** The state of one chain as a list row draws it: one plain Badge, with a dot only while the work is live. */
export interface JobStateView {
    readonly label: string
    readonly tone: JobStateTone
    /** A dot on the Badge: the work is live (it runs, or waits to retry). A result has none. */
    readonly isDot: boolean
    /** What failed, in plain words (a dead letter only); null otherwise. */
    readonly detail: string | null
}

/** The catalog keys (`jobProgress` namespace) of the steps a job reports: one entry per label key the back end declares. */
const JOB_LABEL_WORDS: Readonly<Record<string, string>> = {
    "knowledge.index.read": "step_knowledge_index_read",
    "knowledge.index.chunk": "step_knowledge_index_chunk",
    "knowledge.index.embed": "step_knowledge_index_embed",
    "knowledge.facts.triage": "step_knowledge_facts_triage",
    "knowledge.facts.extract": "step_knowledge_facts_extract",
}

/** The catalog keys of the classes of a dead letter. */
const JOB_CLASS_WORDS: Readonly<Record<string, string>> = {
    input: "class_input",
    config: "class_config",
    transient: "class_transient",
    code: "class_code",
}

/** The sentence of a class of failure ("This file cannot be read"); null for a class the catalogue has no words for. */
export const jobClassWordOf = (failureClass: string, say: (key: string) => string): string | null => {
    const key = JOB_CLASS_WORDS[failureClass]
    return key === undefined ? null : say(key)
}

/** What the words need: the catalogue and the reader's time format. */
export interface JobProgressWords {
    /** The text of a catalog key of the `jobProgress` namespace. */
    readonly say: (key: string, values?: Readonly<Record<string, string | number>>) => string
    /** A moment as the reader reads a clock time. */
    readonly clock: (iso: string) => string
}

/** The step a job reports, with its count when it has one (the step, then done/total); the plain state word when the key is not one the catalogue knows. */
const runningLabelOf = (view: JobProgressView, words: JobProgressWords): string => {
    const key = view.labelKey === null ? undefined : JOB_LABEL_WORDS[view.labelKey]
    if (key === undefined) return words.say("running")
    const hasCount = view.done !== null && view.total !== null && view.total > 0
    return hasCount ? `${words.say(key)} ${String(view.done)}/${String(view.total)}` : words.say(key)
}

/** The Badge words of a state; null when there is nothing to say (no frame, or a result the stored status already says). */
export const jobStateOf = (view: JobProgressView, words: JobProgressWords): JobStateView | null => {
    switch (view.state) {
        case "running":
            return { label: runningLabelOf(view, words), tone: "warning", isDot: true, detail: null }
        case "retry":
            return {
                label: view.retryAt === null ? words.say("retry") : words.say("retryAt", { time: words.clock(view.retryAt) }),
                tone: "neutral",
                isDot: true,
                detail: null,
            }
        case "dead_letter": {
            const key = view.failureClass === null ? undefined : JOB_CLASS_WORDS[view.failureClass]
            return { label: words.say("deadLetter"), tone: "neutral", isDot: false, detail: key === undefined ? null : words.say(key) }
        }
        case "done":
            return { label: words.say("done"), tone: "success", isDot: false, detail: null }
        case "none":
            return null
    }
}
