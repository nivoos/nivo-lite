import { isRecord } from "@modules/platform/primitives"

/** The queue name: the contract between the team chat (in every app that posts a message) and the api's delivery of the tag. */
export const TEAM_CHAT_TAG_QUEUE = "team_chat_tag"

/** The jobs of the team-chat-tag queue; the value is the job name inside the queue. */
export enum TeamChatTagJob {
    /** A member tagged an agent in /chat: the api hands the tag to the one event pipeline (`deliver`). */
    Deliver = "team-chat-tag.deliver",
    /** A person's message was stored: the api asks the turn router which agents it started a turn for, and queues the tag of each of the other agents the message names. */
    Route = "team-chat-tag.route",
}

/** The payload of a deliver job: one tag of one message for one agent, by the member who wrote it (allowed to hand work to it). */
export interface TeamChatTagPayload {
    /** The workspace of the room. */
    readonly workspaceId: string
    /** The tagged agent. */
    readonly agentId: string
    /** The member who wrote the message. */
    readonly memberId: string
    /** The room. */
    readonly roomId: string
    /** The message. */
    readonly messageId: string
    /** The words of the message. */
    readonly text: string
}

/** True when a job payload is the payload of a deliver job. */
export const isTeamChatTagPayload = (value: unknown): value is TeamChatTagPayload =>
    isRecord(value) &&
    ["workspaceId", "agentId", "memberId", "roomId", "messageId", "text"].every((key) => typeof value[key] === "string")

/** The dedupe key of the deliver job of one tag: one per (message, agent), so a repeated post adds no second job. */
export const teamChatTagKeyOf = (messageId: string, agentId: string): string => `team-chat-tag:${messageId}:${agentId}`

/** The payload of a route job: one stored message of a person, by the account that wrote it; the job reads the rest (room, mentions, the line replied to) from the stored message. */
export interface TeamChatRoutePayload {
    /** The workspace of the room. */
    readonly workspaceId: string
    /** The account of the person who wrote the message. */
    readonly userId: string
    /** The room. */
    readonly roomId: string
    /** The message. */
    readonly messageId: string
}

/** True when a job payload is the payload of a route job. */
export const isTeamChatRoutePayload = (value: unknown): value is TeamChatRoutePayload =>
    isRecord(value) && ["workspaceId", "userId", "roomId", "messageId"].every((key) => typeof value[key] === "string")

/** The dedupe key of the route job of one message: one per message, so a repeated send of it writes no second job. */
export const teamChatRouteKeyOf = (messageId: string): string => `team-chat-route:${messageId}`
