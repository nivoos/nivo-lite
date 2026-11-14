/** What resuming stopped work takes: the workspace and the job. */
export interface ResumeStoppedWorkRequest {
    /** The workspace of the job; the caller must own it. */
    readonly workspaceId: string
    /** The stopped job to hand back to its queue. */
    readonly jobId: string
}
