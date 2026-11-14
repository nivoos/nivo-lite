/** Log events of the inbound door: ids, keys and codes only, never the payload of an event. */
export enum AgentInboundLogEvent {
    /** An event woke an agent. */
    Woke = "agent_inbound.woke",
    /** An event matched no agent. */
    NoTarget = "agent_inbound.no_target",
    /** An event reached a workspace its owner deleted; nothing was woken. */
    WorkspaceDeleted = "agent_inbound.workspace_deleted",
    /** A chain of agents hit its limit; a person was told. */
    ChainStopped = "agent_inbound.chain_stopped",
    /** A kept webhook delivery reached its job after its endpoint was removed or disconnected: nothing is woken and the job ends normally. */
    EndpointGone = "agent_inbound.endpoint_gone",
    /** A wake of an adapter ended without a turn. */
    WakeEnded = "agent_inbound.wake_ended",
}
