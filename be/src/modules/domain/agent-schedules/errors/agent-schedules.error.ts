import { DomainError, type ErrorKind } from "@modules/platform/errors"

/** Codes of the agent-schedules capability. */
export enum AgentSchedulesErrorCode {
    /** A drain job names no agent and scope: nothing a retry could change. */
    DrainPayloadInvalid = "AGENT_SCHEDULES_DRAIN_PAYLOAD_INVALID",
}

/** How each agent-schedules code travels. */
export const AGENT_SCHEDULES_ERROR_KINDS: Record<AgentSchedulesErrorCode, ErrorKind> = {
    [AgentSchedulesErrorCode.DrainPayloadInvalid]: "internal",
}

/** The one error class of the agent-schedules capability. */
export class AgentSchedulesError extends DomainError<AgentSchedulesErrorCode> {}
