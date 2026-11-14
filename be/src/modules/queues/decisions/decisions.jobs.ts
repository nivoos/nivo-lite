import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { DECISIONS_QUEUE, DecisionsJob } from "./decisions.contracts"

/** The payload of the graph watch tick: nothing (the tick carries no ids; every installation is walked from the database). */
export interface AgentGraphWatchPayload {
    /** The tick carries no member. */
    readonly [member: string]: never
}

/** True when a job payload is the payload of the graph watch tick: an object (the tick writes an empty one). */
export const isAgentGraphWatchPayload = (value: unknown): value is AgentGraphWatchPayload =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The quarter-hour watch of the agent graphs: it gives an agent with no graph its seed, brings a seed up to its module's base graph (a
 * NEW seed version when the base graph changed, the old version stays; a version a person published never moves), and compares the
 * Brain rules behind the graphs, raising one conflict item per replaced rule (its dedupe key makes a repeat write nothing). It runs in
 * code with no model and acts nowhere outside the database, so it declares no effect and enqueues nothing. Nobody waits for it
 * (`background`); every pass is idempotent, so a retry or a resume repeats no finished change. The tick writes its own once key
 * (`tick:<name>:<minute>`), so the declared key is only the job's name.
 */
export const WATCH_AGENT_GRAPHS_JOB: JobDefinition<AgentGraphWatchPayload> = defineJob<AgentGraphWatchPayload>({
    name: DecisionsJob.AgentGraphWatch,
    queue: DECISIONS_QUEUE,
    ladder: "background",
    payload: isAgentGraphWatchPayload,
    onceKey: () => DecisionsJob.AgentGraphWatch,
    next: [],
    effects: [],
})
