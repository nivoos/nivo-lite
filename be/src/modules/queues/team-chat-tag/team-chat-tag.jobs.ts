import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import {
    TEAM_CHAT_TAG_QUEUE,
    TeamChatTagJob,
    isTeamChatRoutePayload,
    isTeamChatTagPayload,
    teamChatRouteKeyOf,
    teamChatTagKeyOf,
    type TeamChatRoutePayload,
    type TeamChatTagPayload,
} from "./team-chat-tag.contracts"

/**
 * The job that hands one tag of one message to the tagged agent through the one event pipeline. The person who tagged the agent waits
 * for its answer in the room, so it is on the `waited` ladder. The once key is one per (message, agent): the producer writes it as the
 * outbox dedupe key, so a repeated hand-off of the same message (a client retry) is the same job.
 */
export const DELIVER_TEAM_CHAT_TAG_JOB: JobDefinition<TeamChatTagPayload> = defineJob<TeamChatTagPayload>({
    name: TeamChatTagJob.Deliver,
    queue: TEAM_CHAT_TAG_QUEUE,
    ladder: "waited",
    payload: isTeamChatTagPayload,
    onceKey: (payload) => teamChatTagKeyOf(payload.messageId, payload.agentId),
    next: [],
    effects: [],
})

/**
 * The job that routes one stored message of a person: the turn router decides which agents it started a turn for, and the job queues
 * the tag job of each other agent the message names, all in the transaction that finishes it (`next` = the deliver job). The message
 * store transaction writes it under the message id, so a message and its routing commit together and a process that dies between them
 * loses nothing. A person waits for the answer in the room: `waited` ladder.
 */
export const ROUTE_TEAM_CHAT_MESSAGE_JOB: JobDefinition<TeamChatRoutePayload> = defineJob<TeamChatRoutePayload>({
    name: TeamChatTagJob.Route,
    queue: TEAM_CHAT_TAG_QUEUE,
    ladder: "waited",
    payload: isTeamChatRoutePayload,
    onceKey: (payload) => teamChatRouteKeyOf(payload.messageId),
    next: [TeamChatTagJob.Deliver],
    effects: [],
})
