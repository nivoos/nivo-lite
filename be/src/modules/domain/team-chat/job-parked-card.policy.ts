import { jobParkedKind, jobParkedPayload } from "@nivo-lite/agent-sdk/team-chat"
import { parseJsonText } from "@modules/platform/primitives"
import type { StoredAgentMessage } from "./background-stop-card.contracts"
import type {
    JobParkedPayload,
    JobParkedReport,
    OptionalJobParkedCardView,
    OptionalJobParkedPayload,
} from "./job-parked-card.contracts"
import type { TeamCardMessage } from "./team-chat-audience.contracts"
import { lineClientIdOf } from "./team-chat.policy"

/** The kind of NIVO's "a job stopped for a fix" card. */
export const JOB_PARKED_MESSAGE_KIND: typeof jobParkedKind.id = jobParkedKind.id

/** The client id of the ONE card of a park episode of a job: a repeat of the same episode names the same line. */
export const jobParkedKeyOf = (jobId: string, episode: number): string =>
    lineClientIdOf(`job-parked:${jobId}:${String(episode)}`)

/** The payload of the card of a report, parked at `now`. */
export const jobParkedPayloadOf = (report: JobParkedReport, now: Date): JobParkedPayload => ({
    version: 1,
    jobId: report.jobId,
    job: report.job,
    failureClass: report.failureClass,
    reason: report.reason,
    episode: report.episode,
    since: now.toISOString(),
})

/**
 * The message of the card: it only tells (no one-tap reply; resume and close are the person's door, `stoppedWork`). Title and line
 * are the codes, never words: the web words the card from its payload.
 */
export const jobParkedMessageOf = (payload: JobParkedPayload): TeamCardMessage => ({
    kind: JOB_PARKED_MESSAGE_KIND,
    intent: "notify",
    title: payload.job,
    summary: `${payload.job} · ${payload.reason}`,
    payload,
    options: [],
})

/** The payload of a stored `job.parked` card, or null when the line is no such card or does not read. */
export const storedJobParkedOf = (agentMessage: StoredAgentMessage): OptionalJobParkedPayload => {
    if (agentMessage === null) return null
    const read = parseJsonText(agentMessage)
    if (!read.ok || typeof read.value !== "object" || read.value === null) return null
    if (Reflect.get(read.value, "kind") !== JOB_PARKED_MESSAGE_KIND) return null
    const parsed = jobParkedPayload.safeParse(Reflect.get(read.value, "payload"))
    return parsed.success ? parsed.data : null
}

/** A `job.parked` card as a screen reads it, or null when the line is no such card. */
export const jobParkedCardViewOf = (agentMessage: StoredAgentMessage): OptionalJobParkedCardView => {
    const payload = storedJobParkedOf(agentMessage)
    if (payload === null) return null
    const { version: _shape, ...shown } = payload
    return shown
}
