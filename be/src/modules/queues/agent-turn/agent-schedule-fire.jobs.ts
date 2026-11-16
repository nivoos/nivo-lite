import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import {
    AGENT_SCHEDULE_FIRE_JOB,
    AGENT_SCHEDULE_FIRE_QUEUE,
    AgentTurnJob,
    isAgentScheduleFirePayload,
    type AgentScheduleFirePayload,
} from "./agent-turn.contracts"

/**
 * One slot of one agent trigger came up. The one job that starts with no outbox row: a job scheduler of the trigger row fires it into
 * its own queue, and the slot (the scheduler's job id) is its identity, written as the once key `<triggerId>:<slot>` of the wake it
 * delivers, so the same slot twice is one wake. Nobody waits for it (`background`). When it finishes it has written the wake and its
 * drain in the transaction that records the fire, so its `next` is the drain. A scheduled job is dead-lettered like any other: a
 * permanent failure on the first try, a transient one after the broker's tries (`SCHEDULE_ATTEMPTS`), with one item for a person; the
 * job is idempotent, so a person's resume fires the slot again safely.
 */
export const FIRE_AGENT_SCHEDULE_JOB: JobDefinition<AgentScheduleFirePayload> = defineJob<AgentScheduleFirePayload>({
    name: AGENT_SCHEDULE_FIRE_JOB,
    queue: AGENT_SCHEDULE_FIRE_QUEUE,
    ladder: "background",
    payload: isAgentScheduleFirePayload,
    onceKey: (payload) => `${AGENT_SCHEDULE_FIRE_JOB}:${payload.triggerId}:${payload.slot}`,
    next: [AgentTurnJob.Drain],
    effects: [],
})
