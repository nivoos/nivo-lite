/** What createAgentWorkflow takes. */
export interface CreateAgentWorkflowRequest {
    /** The workspace the request is made in. */
    readonly workspaceId: string
    /** The installation whose agent holds the workflows. */
    readonly installationId: string
    /** The template to copy: a workflow is always a template's copy. */
    readonly templateId: string
    /** The template version to copy; the newest when absent. */
    readonly templateVersion?: number | null
    /** The language of the names; Vietnamese unless en is named. */
    readonly locale?: string | null
}
