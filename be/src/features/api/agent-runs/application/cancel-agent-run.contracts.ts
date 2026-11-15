/** What cancelAgentRun takes: END one run in flight, whatever its state. */
export interface CancelAgentRunRequest {
    /** The workspace the request is made in. */
    readonly workspaceId: string
    /** The run to end. */
    readonly runId: string
    /** True: the agent's model words one line to the run's customer, sent through the normal send door; false: nobody is told. */
    readonly tellCustomer: boolean
}

/** What pauseAgentRun and resumeAgentRun take. */
export interface RunPauseRequest {
    /** The workspace the request is made in. */
    readonly workspaceId: string
    /** The run. */
    readonly runId: string
}

/** What endAgentWorkflowRuns takes: end every run of one workflow in flight. */
export interface EndWorkflowRunsRequest {
    /** The workspace the request is made in. */
    readonly workspaceId: string
    /** The workflow. */
    readonly workflowId: string
}
