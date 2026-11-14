import type { TeamChatMarkView } from "./team-chat-room"
import type { TeamChatStopLineView } from "./team-chat-stop"

/** The structured card of a message NIVO posts when a background job stopped for a fix (`ChatMessageType.jobParked`, the `job.parked` kind). */
export interface TeamChatJobParked {
    /** The name of the job; a name the web has no words for reads as a generic title. */
    readonly job: string
    /** The job's id, or `event:<queue>:<event id>` for a buried event; the door of a resume takes it. */
    readonly jobId: string
    /** Why it will not run on its own: `transient`, `input`, `code` or `config`; an unknown class reads as generic words. */
    readonly failureClass: string
    /** The failure code (folded into the details, never the card's words). */
    readonly reason: string
    /** How many times a person resumed the job before this park. */
    readonly episode: number
    /** When it stopped (ISO). */
    readonly since: string
}

/** What a person does on the card: run the job again, or close it for good with the reason they give. */
export type TeamChatJobParkedAction =
    | { readonly kind: "resume" }
    | { readonly kind: "close"; readonly reason: string }

/** The words of the buttons and the close form of a card. */
export interface TeamChatJobParkedLabels {
    readonly resume: string
    readonly close: string
    readonly closeReasonLabel: string
    readonly closeSubmit: string
    readonly cancel: string
}

/** A "job stopped" card with every word resolved; the raw codes stay in `facts`, folded by the card. */
export interface TeamChatJobParkedView {
    readonly mark: TeamChatMarkView
    /** Who says it: NIVO's name. */
    readonly author: string
    /** The muted line under the name: the job in words and the time. */
    readonly meta: string
    readonly chip: string
    /** What stopped, in plain words. */
    readonly title: string
    /** The class of the failure in one sentence. */
    readonly message: string
    /** The id the doors take (a job id, or `event:<queue>:<event id>`). */
    readonly jobId: string
    /** A job may be closed with a reason; a buried event can only be put back on its queue. */
    readonly canClose: boolean
    readonly labels: TeamChatJobParkedLabels
    readonly detailsLabel: string
    readonly factsLabel: string
    readonly facts: ReadonlyArray<TeamChatStopLineView>
}

/** What the thread does with the job cards: the card whose action is in flight and the one handler. */
export interface TeamChatJobParkedHandlers {
    /** The job whose action is in flight, or null. */
    readonly pendingId: string | null
    readonly onAction: (jobId: string, action: TeamChatJobParkedAction) => void
}
