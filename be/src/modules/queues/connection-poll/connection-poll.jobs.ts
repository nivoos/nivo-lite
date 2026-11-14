import { defineJob, type JobDefinition } from "@modules/platform/jobs"
import { CONNECTION_POLL_QUEUE, POLL_DUE_CONNECTIONS_JOB } from "./connection-poll.queue"

/**
 * The payload of the poll tick: it names nothing, the tick asks the schedule table what is due.
 */
export type ConnectionPollTick = Record<string, never>

/**
 * The scheduler's tick: it claims the connections that are due, polls each under its provider's declared limits and plans the next poll
 * from how it ended, by the provider's DECLARED schedule (the adaptive interval, the backoff of a 429 or a transient failure, the breaker
 * with its cool-down, the owner's request of a refused credential). That schedule is the cadence of a poll, not a retry of a failed job:
 * a connection's failed read is a typed outcome the schedule plans from, never a throw that stops the tick, and a poll that must wait
 * for the provider's limit is planned again at the time the limit names (nothing in the tick sleeps). Nobody waits on it, so it is
 * `background`; the next tick is the sweep that brings back what a crash left (a claimed connection frees itself when its lease ends).
 */
export const POLL_DUE_JOB: JobDefinition<ConnectionPollTick> = defineJob<ConnectionPollTick>({
    name: POLL_DUE_CONNECTIONS_JOB,
    queue: CONNECTION_POLL_QUEUE,
    ladder: "background",
    payload: (value): value is ConnectionPollTick => typeof value === "object" && value !== null,
    onceKey: () => POLL_DUE_CONNECTIONS_JOB,
    next: [],
    effects: [],
})
