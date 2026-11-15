/** What every call of the workflows tab names: the installation whose agent holds the workflows. */
export interface WorkflowsRequest {
    /** The installation. */
    readonly installationId: string
    /** The language of the names; Vietnamese unless en. */
    readonly locale?: string | null | undefined
}

/** What a call about one workflow names. */
export interface WorkflowRequest extends WorkflowsRequest {
    /** The workflow. */
    readonly workflowId: string
}

/** What a version diff names. */
export interface WorkflowDiffRequest extends WorkflowRequest {
    /** The version to read. */
    readonly number: number
    /** What to compare with: previous, version or template. */
    readonly against: string
    /** The version or template version to compare with. */
    readonly againstNumber?: number | null | undefined
}

/** What a template preview names. */
export interface WorkflowTemplateVersionRequest extends WorkflowRequest {
    /** The template version. */
    readonly templateVersion: number
}

/** What adding a workflow names: the template (and version) to copy; a workflow is always a template's copy. */
export interface WorkflowCreateRequest extends WorkflowsRequest {
    /** The template to copy. */
    readonly templateId: string
    /** The template version to copy; the newest when absent. */
    readonly templateVersion?: number | null | undefined
}

/** One operation on a connected account the owner agreed a version may call, exactly as the refusal `RIGHTS_NEED_OWNER` listed it. */
export interface AgreedRightRequest {
    /** The key of the node. */
    readonly nodeKey: string
    /** The connected account. */
    readonly connectionId: string
    /** The operation, by tool id. */
    readonly operation: string
    /** `auto` or `ask`. */
    readonly mode: string
}

/** What an activation carries about rights: the entries the owner agreed, absent when nothing was asked of them. */
export interface AgreedRightsRequest {
    /** The entries the owner agreed. */
    readonly agreedRights?: ReadonlyArray<AgreedRightRequest> | null | undefined
}

/** What a change that writes a version names: why, and the newest version the caller read. */
export interface WorkflowChangeRequest extends WorkflowRequest, AgreedRightsRequest {
    /** Why the version is made. */
    readonly note: string
    /** The newest version number the caller read. */
    readonly expectedLatest?: number | null | undefined
}

/**
 * What setting ONE node step's settings names (`node-settings.policy`): the node by its key in the workflow's running graph, each setting
 * to change (absent: left as it is), and the newest version the caller read. Owner only.
 */
export interface WorkflowNodeSettingsRequest extends WorkflowRequest {
    /** The node, by its key in the running graph. */
    readonly nodeKey: string
    /** `auto` or `ask`; absent: the mode is left. */
    readonly mode?: string | null | undefined
    /** The attached accounts the step uses, in try order; `[]`: the default pick; absent: the choice is left. */
    readonly accountIds?: ReadonlyArray<string> | null | undefined
    /** The newest version number the caller read; a newer one refuses the change. */
    readonly expectedLatest?: number | null | undefined
}

/** What a rollback names. */
export interface WorkflowRollbackRequest extends WorkflowChangeRequest {
    /** The version to go back to. */
    readonly number: number
}

/** What accepting a template version names. */
export interface WorkflowAcceptRequest extends WorkflowChangeRequest {
    /** The template version to accept. */
    readonly templateVersion: number
}

/** One pick of the ONE source of a contested stream for a trigger purpose of a running workflow, as readiness names it. */
export interface AgentTriggerPickRequest {
    /** The workflow. */
    readonly workflowId: string
    /** The trigger purpose (verb). */
    readonly verb: string
    /** The stream, as readiness named it. */
    readonly stream: string
    /** The account picked. */
    readonly connectionId: string
}

/** What one consent over the running workflows of an installation's agent names. */
export interface AgentRightsAgreeRequest {
    /** The installation whose agent holds the workflows. */
    readonly installationId: string
    /** The owner's picks of one source per contested stream (owner key `triggerOneSource2026_11_12`); absent or empty for none. */
    readonly triggerPicks?: ReadonlyArray<AgentTriggerPickRequest> | null | undefined
}

/** What a status change names. */
export interface WorkflowStatusRequest extends WorkflowRequest, AgreedRightsRequest {
    /** active, draft or paused. */
    readonly status: string
    /** A STOP (`paused`): true keeps the events that come while stopped for its start (run in order); false records them, not run. */
    readonly holdEvents?: boolean | null
    /** A STOP: true also ends every run of the workflow in flight (the run door, one by one); false lets them go on. */
    readonly endRuns?: boolean | null
}

/** What a template listing names. */
export interface TemplatesRequest {
    /** The module, or none for all. */
    readonly moduleKey?: string | null | undefined
    /** The language. */
    readonly locale?: string | null | undefined
}

/** What reading one template names. */
export interface TemplateRequest {
    /** The template. */
    readonly templateId: string
    /** The language. */
    readonly locale?: string | null | undefined
}

/** What reading the pins of runs names. */
export interface RunPinsRequest {
    /** The installation whose agent ran them. */
    readonly installationId: string
    /** The runs. */
    readonly runIds: ReadonlyArray<string>
}

