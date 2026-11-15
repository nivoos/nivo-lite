/** What resumeAgentRun takes. */
export interface ResumeAgentRunRequest {
    /** The workspace the request is made in. */
    readonly workspaceId: string
    /** The paused run. */
    readonly runId: string
}
