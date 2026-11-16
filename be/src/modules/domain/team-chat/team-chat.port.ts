import type { EntityManager } from "typeorm"

/** What a person tagging an agent hands over: who tagged, whom, where and what was written. */
export interface TeamChatTag {
    /** The account of the person who wrote the message, whose right to hand work to the agent is checked. */
    readonly userId: string
    /** The agent that is tagged. */
    readonly agentId: string
    /** The room the message was written in, which becomes the subject of the work. */
    readonly roomId: string
    /** The message that tags the agent; one message tags one agent once. */
    readonly messageId: string
    /** The text of the message, which the agent receives as its task. */
    readonly text: string
}

/** What the chat asks of the work core when a person's message is stored or tags an agent. */
export interface TeamChatTags {
    /**
     * Writes, in the caller's transaction (the one that stores the message), the job that routes the message: the turn router decides which
     * agents it started a turn for and the tag of each other agent the message names follows. One job per message: a repeat is the same job.
     */
    queueRoute(tx: EntityManager, route: TeamChatRoute): Promise<void>
    /**
     * Hands the text of a message to the tagged agent: writes, in the caller's transaction, the job that delivers the wake of kind `tag`
     * that starts the agent graph, with the room, the message and the person who wrote it. The same message tags the same agent once.
     * False when the person may not hand work to that agent (nothing is written).
     */
    handOff(tx: EntityManager, workspaceId: string, tag: TeamChatTag): Promise<boolean>
}

/** The stored message of a person the chat asks to route. */
export interface TeamChatRoute {
    /** The workspace of the room. */
    readonly workspaceId: string
    /** The account of the person who wrote the message. */
    readonly userId: string
    /** The room. */
    readonly roomId: string
    /** The message. */
    readonly messageId: string
}
