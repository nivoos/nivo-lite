import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the tools registry. */
export enum ToolsErrorCode {
    /** The connector has no such tool. */
    UnknownTool = "TOOLS_UNKNOWN_TOOL",
    /** The input of a console command is not valid. */
    Invalid = "TOOLS_INVALID",
    /** A tool call does not match its bounded argument schema. */
    InvalidArguments = "TOOLS_INVALID_ARGUMENTS",
    /** The agent is not one of the workspace. */
    AgentNotFound = "TOOLS_AGENT_NOT_FOUND",
    /** The native adapter did not answer within the time limit. */
    Timeout = "TOOLS_TIMEOUT",
    /** A native adapter refused an expected case (`not_connected`, `internal_only`): an answer to the caller, never a failure of the connector. */
    NativeRefused = "TOOLS_NATIVE_REFUSED",
    /** An agent's attachment to a provider, or an ability on it, cannot be changed as asked; `reason` says why. */
    AttachmentRefused = "TOOLS_ATTACHMENT_REFUSED",
    /**
     * A step's call needs an account of a provider of which the agent holds several, and neither the run's trigger, nor the run's earlier
     * calls, nor the agent's default account of the provider names one: the owner picks a default. `provider` and `connectionIds` (the
     * candidate accounts, comma separated) ride in the params; nothing was sent.
     */
    AccountNeedsPick = "TOOLS_ACCOUNT_NEEDS_PICK",
    /**
     * ONE WORLD PER RUN (lane concept provider-sandbox rule 19): the run acts in one world (`world`: sandbox or live) and the agent holds no
     * account of that world of the provider the step's call needs (`provider`), only of the other: the call is never made in the other
     * world; nothing was sent.
     */
    AccountOtherWorld = "TOOLS_ACCOUNT_OTHER_WORLD",
    /**
     * ONE WORLD PER RUN: nothing fixes the run's world (no event account, no caller, no earlier call, the agent's defaults do not agree on
     * one) and the accounts serving the call (`provider`) are of both worlds: never a guess between them; the owner sets a default account.
     */
    RunWorldUndecided = "TOOLS_RUN_WORLD_UNDECIDED",
}

/** How each code travels. */
export const TOOLS_ERROR_KINDS: Record<ToolsErrorCode, ErrorKind> = {
    [ToolsErrorCode.UnknownTool]: "not-found",
    [ToolsErrorCode.Invalid]: "invalid",
    [ToolsErrorCode.InvalidArguments]: "invalid",
    [ToolsErrorCode.AgentNotFound]: "not-found",
    [ToolsErrorCode.Timeout]: "unavailable",
    [ToolsErrorCode.NativeRefused]: "forbidden",
    [ToolsErrorCode.AttachmentRefused]: "invalid",
    [ToolsErrorCode.AccountNeedsPick]: "conflict",
    [ToolsErrorCode.AccountOtherWorld]: "conflict",
    [ToolsErrorCode.RunWorldUndecided]: "conflict",
}

/** The one error class of the gateway. */
export class ToolsError extends DomainError<ToolsErrorCode> {}
