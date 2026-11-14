import type { TeamChatJobParked, TeamChatJobParkedLabels, TeamChatJobParkedView } from "@/modules/types"
import { NIVO_MARK } from "./backgroundStopped"

/** The prefix of the id of a buried event card (`event:<queue>:<event id>`): its way out is another door than a job's. */
const EVENT_ID_PREFIX = "event:"

/** Every word a "job stopped" card needs, in the viewer's language; an unknown job or class answers the generic words. */
export interface JobParkedWords {
    readonly nivoName: string
    readonly chip: string
    /** What stopped, in plain words; the generic title for a job the web has no words for. */
    readonly titleOf: (job: string) => string
    /** What the job is called in the muted line; the generic name for a job the web has no words for. */
    readonly nameOf: (job: string) => string
    /** The one sentence for a class of failure; the generic sentence for a class the web does not know. */
    readonly classOf: (failureClass: string) => string
    readonly labels: TeamChatJobParkedLabels
    readonly detailsLabel: string
    readonly factsLabel: string
    readonly factJob: string
    readonly factClass: string
    readonly factReason: string
    readonly factSince: string
    readonly timeOf: (iso: string) => string
    /** The clock and the day of a moment ("15:02 11/11"). */
    readonly sinceOf: (iso: string) => string
}

const SEPARATOR = " · "

/** The queue and the event id of a buried event's card id; null for a job's id. A queue name holds no `:`, so the split is at the last one. */
export const eventOfJobId = (jobId: string): { readonly queue: string; readonly eventId: string } | null => {
    if (!jobId.startsWith(EVENT_ID_PREFIX)) return null
    const rest = jobId.slice(EVENT_ID_PREFIX.length)
    const at = rest.lastIndexOf(":")
    if (at <= 0 || at === rest.length - 1) return null
    return { queue: rest.slice(0, at), eventId: rest.slice(at + 1) }
}

/**
 * The "job stopped" card of a NIVO message with every word resolved. The codes the back end sent are words here, never shown raw; they
 * stay only in the folded `facts` (job, class, reason, since), where a person debugging may need them.
 */
export const jobParkedViewOf = (card: TeamChatJobParked, words: JobParkedWords): TeamChatJobParkedView => ({
    mark: NIVO_MARK,
    author: words.nivoName,
    meta: [words.nameOf(card.job), words.timeOf(card.since)].join(SEPARATOR),
    chip: words.chip,
    title: words.titleOf(card.job),
    message: words.classOf(card.failureClass),
    jobId: card.jobId,
    canClose: eventOfJobId(card.jobId) === null,
    labels: words.labels,
    detailsLabel: words.detailsLabel,
    factsLabel: words.factsLabel,
    facts: [
        { id: "job", name: words.factJob, value: card.job },
        { id: "class", name: words.factClass, value: card.failureClass },
        { id: "reason", name: words.factReason, value: card.reason },
        { id: "since", name: words.factSince, value: words.sinceOf(card.since) },
    ],
})
