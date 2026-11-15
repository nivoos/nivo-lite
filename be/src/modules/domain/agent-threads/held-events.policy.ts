import { isLatestWake, streamCountOf, type AgentWakeContext } from "@modules/domain/agent-work"

/**
 * ENGINE-FIN (a): how many events a set of wakes held behind a run stands for, by the combine its trigger declares and nothing else: a
 * `stream` marker counts the events folded into it (`count`), an `each` wake is one event, a `latest` wake is ONE (only the newest of its
 * set is the work: what it replaced never runs). The same for every data source (a person's lines, record write events).
 */
export const heldEventsOf = (held: ReadonlyArray<Pick<AgentWakeContext, "combine" | "count">>): number =>
    held.reduce((sum, context) => sum + (isLatestWake(context) ? 1 : streamCountOf(context)), 0)
