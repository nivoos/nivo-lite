/** What setAgentNodeSettings takes. */
export interface SetAgentNodeSettingsRequest {
    /** The workspace the request is made in. */
    readonly workspaceId: string
    /** The installation whose agent holds the workflow. */
    readonly installationId: string
    /** The workflow. */
    readonly workflowId: string
    /** The node, by its key in the workflow's running graph. */
    readonly nodeKey: string
    /** `auto` or `ask`; absent: the mode is left. */
    readonly mode?: string | null
    /** The agent's attached accounts the step uses, in try order; `[]`: the default pick; absent: the choice is left. */
    readonly accountIds?: ReadonlyArray<string> | null
    /** The newest version number the caller read; a newer one refuses the change. */
    readonly expectedLatest?: number | null
}
