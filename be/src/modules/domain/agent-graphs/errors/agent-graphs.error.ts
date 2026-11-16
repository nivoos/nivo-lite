import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the agent-graphs capability. */
export enum AgentGraphsErrorCode {
    /** The agent has no graph yet. */
    GraphNotFound = "AGENT_GRAPHS_GRAPH_NOT_FOUND",
    /** The version is not a version of the agent. */
    VersionNotFound = "AGENT_GRAPHS_VERSION_NOT_FOUND",
    /** Someone saved the draft after it was read. */
    DraftConflict = "AGENT_GRAPHS_DRAFT_CONFLICT",
    /** The graph still has problems the owner must fix before it is published. */
    PublishRefused = "AGENT_GRAPHS_PUBLISH_REFUSED",
    /** A draft whose flow names a model the vocabulary does not know, or a model on a node that calls no AI. */
    ModelRefused = "AGENT_GRAPHS_MODEL_REFUSED",
    /** The agent's module belongs to a private plugin the workspace may no longer use (its enterprise identifier does not match). */
    ModuleClosed = "AGENT_GRAPHS_MODULE_CLOSED",
    /** A new version whose triggers, outcomes or end hand-offs break a workflow contract, or that would break a workflow that calls it. */
    ContractRefused = "AGENT_GRAPHS_CONTRACT_REFUSED",
    /** The change gives the agent more reach, and only the owner may publish that. */
    WidensNeedsOwner = "AGENT_GRAPHS_WIDENS_NEEDS_OWNER",
    /**
     * The version asks for operations on connected accounts beyond what its workflow holds (a new operation, or `auto` where it holds
     * `ask`): it activates only when the owner agrees to every one of them. `params.rights` lists them as JSON, each with the
     * title of the step that asks (`stepTitle`, in the owner's two languages; null for a step no installed node is).
     */
    RightsNeedOwner = "AGENT_GRAPHS_RIGHTS_NEED_OWNER",
    /** The graph is not a graph the product can read. */
    DocumentInvalid = "AGENT_GRAPHS_DOCUMENT_INVALID",
    /** Only the owner or a manager of the workspace may read or change an agent graph. */
    Forbidden = "AGENT_GRAPHS_FORBIDDEN",
    /** The graph never decided this work item. */
    RunNotFound = "AGENT_GRAPHS_RUN_NOT_FOUND",
    /** A stored record is not the shape its entity declares. */
    RecordUnreadable = "AGENT_GRAPHS_RECORD_UNREADABLE",
    /** The workflow is not a workflow of the agent, or the version is not a version of the workflow. */
    WorkflowNotFound = "AGENT_GRAPHS_WORKFLOW_NOT_FOUND",
    /** The workflow template, or the template version, does not exist. */
    TemplateNotFound = "AGENT_GRAPHS_TEMPLATE_NOT_FOUND",
    /** Someone published a version of the workflow after it was read. */
    WorkflowConflict = "AGENT_GRAPHS_WORKFLOW_CONFLICT",
    /** The workflow change is refused: its graph has problems, the status move or the template version is not allowed. */
    WorkflowRefused = "AGENT_GRAPHS_WORKFLOW_REFUSED",
    /** A person's queued start of a workflow reached the pipeline and no live registration of the agent took it (the workflow was paused or replaced since): nothing was claimed, and a resume delivers it once the workflow runs again. */
    WorkflowStartUntaken = "AGENT_GRAPHS_WORKFLOW_START_UNTAKEN",
    /** A workflow wake reached the flow before the thread engine registered: the app composed no engine to run it. */
    EngineMissing = "AGENT_GRAPHS_ENGINE_MISSING",
    /**
     * A pick of a trigger's source names a workflow not of the agent, a stream its attached accounts do not contest for that purpose, or
     * an account that does not read that stream (owner key `triggerOneSource2026_11_12`): nothing is written.
     */
    TriggerPickRefused = "AGENT_GRAPHS_TRIGGER_PICK_REFUSED",
    /** A node setting the step does not take (`params.setting`: `mode` on a control step, `accounts` on a step that lists no provider). */
    NodeSettingUnsettable = "AGENT_GRAPHS_NODE_SETTING_UNSETTABLE",
    /** A chosen account the agent is not attached to (`params.connectionId`). */
    NodeAccountNotAttached = "AGENT_GRAPHS_NODE_ACCOUNT_NOT_ATTACHED",
    /** A chosen account whose connection does not work (not `connected`; `params.connectionId`). */
    NodeAccountNotConnected = "AGENT_GRAPHS_NODE_ACCOUNT_NOT_CONNECTED",
    /** A chosen account of a provider the step does not list (`params.connectionId`, `params.provider`). */
    NodeAccountNotListed = "AGENT_GRAPHS_NODE_ACCOUNT_NOT_LISTED",
    /** A chosen SANDBOX account where the sandbox is off (`params.connectionId`). */
    NodeAccountSandboxOff = "AGENT_GRAPHS_NODE_ACCOUNT_SANDBOX_OFF",
    /** One account chosen twice in one choice (`params.connectionId`). */
    NodeAccountRepeated = "AGENT_GRAPHS_NODE_ACCOUNT_REPEATED",
}

/** How each agent-graphs code travels. */
export const AGENT_GRAPHS_ERROR_KINDS: Record<AgentGraphsErrorCode, ErrorKind> = {
    [AgentGraphsErrorCode.GraphNotFound]: "not-found",
    [AgentGraphsErrorCode.VersionNotFound]: "not-found",
    [AgentGraphsErrorCode.DraftConflict]: "conflict",
    [AgentGraphsErrorCode.PublishRefused]: "invalid",
    [AgentGraphsErrorCode.ModelRefused]: "invalid",
    [AgentGraphsErrorCode.ModuleClosed]: "forbidden",
    [AgentGraphsErrorCode.ContractRefused]: "invalid",
    [AgentGraphsErrorCode.WidensNeedsOwner]: "forbidden",
    [AgentGraphsErrorCode.RightsNeedOwner]: "forbidden",
    [AgentGraphsErrorCode.DocumentInvalid]: "internal",
    [AgentGraphsErrorCode.Forbidden]: "forbidden",
    [AgentGraphsErrorCode.RunNotFound]: "not-found",
    [AgentGraphsErrorCode.RecordUnreadable]: "internal",
    [AgentGraphsErrorCode.WorkflowNotFound]: "not-found",
    [AgentGraphsErrorCode.TemplateNotFound]: "not-found",
    [AgentGraphsErrorCode.WorkflowConflict]: "conflict",
    [AgentGraphsErrorCode.WorkflowRefused]: "invalid",
    [AgentGraphsErrorCode.WorkflowStartUntaken]: "conflict",
    [AgentGraphsErrorCode.EngineMissing]: "internal",
    [AgentGraphsErrorCode.TriggerPickRefused]: "invalid",
    [AgentGraphsErrorCode.NodeSettingUnsettable]: "invalid",
    [AgentGraphsErrorCode.NodeAccountNotAttached]: "invalid",
    [AgentGraphsErrorCode.NodeAccountNotConnected]: "invalid",
    [AgentGraphsErrorCode.NodeAccountNotListed]: "invalid",
    [AgentGraphsErrorCode.NodeAccountSandboxOff]: "invalid",
    [AgentGraphsErrorCode.NodeAccountRepeated]: "invalid",
}

/** The one error class of the agent-graphs capability. */
export class AgentGraphsError extends DomainError<AgentGraphsErrorCode> {}
