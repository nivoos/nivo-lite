/** What releaseConversation takes: the conversation (its route). */
export interface ReleaseConversationRequest {
    /** The workspace. */
    readonly workspaceId: string
    /** The conversation: its route. */
    readonly conversationId: string
}
