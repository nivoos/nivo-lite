/** What closing stopped work takes: the workspace, the job and the person's reason. */
export interface CloseStoppedWorkRequest {
    /** The workspace of the job; the caller must own it. */
    readonly workspaceId: string
    /** The stopped job to close for good. */
    readonly jobId: string
    /** Why it is closed. */
    readonly reason: string
}
