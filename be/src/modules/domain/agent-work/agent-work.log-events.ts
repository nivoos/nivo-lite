/** Log events of the agent work store: ids only, never the words of a customer or a colleague. */
export enum AgentWorkLogEvent {
    /** A new fact woke an agent. */
    WakeWritten = "agent_work.wake_written",
    /** Wakes of a `stream` declaration were folded into their oldest un-run wake (rule Q-4). */
    WakeCoalesced = "agent_work.wake_coalesced",
    /** Older un-run wakes of a `latest` declaration were closed `replaced:<newest>` by the wake just written (rule Q-4). */
    WakeReplaced = "agent_work.wake_replaced",
    /** A worker took a turn. */
    TurnBegun = "agent_work.turn_begun",
    /** The scope was already held by another worker. */
    TurnBusy = "agent_work.turn_busy",
    /** A worker lost its lease and stopped before any effect. */
    TurnFenced = "agent_work.turn_fenced",
    /** A wake spent its attempts and was given up. */
    WakeDead = "agent_work.wake_dead",
    /** A wake of a source this process no longer serves was closed by name (`source_retired`), never tried again. */
    WakeSourceRetired = "agent_work.wake_source_retired",
    /** A wake had no handler, so it was held. */
    NoHandler = "agent_work.no_handler",
    /** A turn failed and will be retried or given up. */
    TurnFailed = "agent_work.turn_failed",
    /** A turn ran past its heartbeat budget, so its lease is left to lapse and its signal aborted. */
    TurnOverran = "agent_work.turn_overran",
    /** A drain came before the burst window of its conversation ended, so one more drain was scheduled for the time left. */
    DrainRearmed = "agent_work.drain_rearmed",
    /** A drain came early again after its last allowed follow-up: the wake is left to the minute sweep. */
    DrainRearmSpent = "agent_work.drain_rearm_spent",
    /** The heartbeat could not renew the lease. */
    HeartbeatFailed = "agent_work.heartbeat_failed",
}
