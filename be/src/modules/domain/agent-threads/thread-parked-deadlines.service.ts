import { Injectable, Optional } from "@nestjs/common"
import { AgentRunsService, type RunView } from "@modules/domain/agent-runs"
import { InjectGraphThreads, type GraphThreads, type ThreadRef } from "@modules/integrations/langgraph"
import { eachInOrder } from "@modules/platform/primitives"
import type { ThreadDeadlinePayload } from "@modules/queues/thread-deadline"
import { ThreadDeadlinesService, type DeadlineFiring } from "./thread-deadlines.service"
import { RETRY_PARK_PREFIX } from "./thread-step.service"
import { parkOfWaitQuestion, waitPayloadOf } from "./thread-waits.policy"
import { RunStopsService } from "./stops/run-stops.service"
import { parkOfQuestion, parkPayloadOf } from "./until-rounds.policy"

/** The most in-flight runs one read looks at. */
const PARKED_MAX = 50

/**
 * Which deadline a thread is parked on, named by the engine's own park: a `wait`'s timeout, an until loop's next round, a retry-ladder
 * rung (an until park filed under `retry:<step>`), an approval's expiry, or a stop's deadline for a person.
 */
export type ParkedDeadlineKind = "wait" | "round" | "retry" | "approval" | "stop"

/** A run parked on a deadline: the run, its agent, its trigger as it began, which deadline, its key, when it comes and what a wait listens for. */
export interface ParkedDeadline {
    /** The run. */
    readonly runId: string
    /** The agent of the run. */
    readonly agentId: string
    /** The run's trigger context, intact (the person and the route it is about). */
    readonly context: Readonly<Record<string, unknown>>
    /** Which deadline the thread is parked on. */
    readonly kind: ParkedDeadlineKind
    /** The key its deadline job is filed under (the wait's or the until park's key, the stop's step key). */
    readonly parkKey: string
    /** When it comes (ISO 8601). */
    readonly dueAt: string
    /** What a `wait` listens for (the key the wake names each trigger by, and its verb); empty for every other deadline. */
    readonly waitsFor: ReadonlyArray<{ readonly key: string; readonly verb: string }>
}

/** A parked deadline and the payload of its deadline job. */
interface Parked {
    readonly deadline: Omit<ParkedDeadline, "runId" | "agentId" | "context">
    readonly payload: ThreadDeadlinePayload
}

@Injectable()
/**
 * ENGINE-FIN (b), the dev time levers: every parked thread has ONE deadline road (the `thread-deadline` job -> `ThreadDeadlinesService`),
 * whatever it waits for: a `wait`'s timeout, an until round or a retry-ladder rung, an approval's expiry, a stop's deadline for a person.
 * This door lists the workspace's runs parked on a deadline and fires a run's deadline NOW through that real road (`fireNow`, the same
 * function the job and a person's "run now" call), so the run goes on exactly as when the time runs out. Generic: it reads the thread's
 * own park, knows no business and no sandbox; who may call it and when (the sandbox switch, never production) is its caller's rule.
 */
export class ThreadParkedDeadlinesService {
    constructor(
        private readonly runs: AgentRunsService,
        private readonly deadlines: ThreadDeadlinesService,
        private readonly stops: RunStopsService,
        @Optional() @InjectGraphThreads() private readonly port?: GraphThreads,
    ) {}

    /** The workspace's runs parked on a deadline, newest start first, at most `limit` (capped at 50) runs read; a run parked on none is left out. */
    async parked(workspaceId: string, limit: number): Promise<ReadonlyArray<ParkedDeadline>> {
        const runs = await this.runs.inFlightThreads(workspaceId, Math.max(0, Math.min(limit, PARKED_MAX)))
        const found: Array<ParkedDeadline> = []
        await eachInOrder(runs, async (run: RunView) => {
            const parked = await this.parkedOf({ workspaceId, runId: run.id })
            if (parked !== null) found.push({ runId: run.id, agentId: run.agentId, context: run.context, ...parked.deadline })
        })
        return found
    }

    /**
     * Fires the run's deadline NOW through the real deadline road: `admitted` when its wake was written (the run goes on as when the time
     * runs out); `closed` when the run is parked on no deadline; `refused` / `moved` as the road answers (an event took the park first).
     */
    async fireNow(workspaceId: string, runId: string): Promise<DeadlineFiring> {
        const parked = await this.parkedOf({ workspaceId, runId })
        return parked === null ? "closed" : this.deadlines.fireNow(parked.payload)
    }

    /** The deadline the thread is parked on, read from its own interrupt, or null (no port, no thread, not stopped, an engine stop, a take-over). */
    private async parkedOf(ref: ThreadRef): Promise<Parked | null> {
        const view = (await this.port?.stateOf(ref)) ?? null
        if (view?.status !== "stopped") return null
        const question: unknown = view.stop?.question
        const wait = parkOfWaitQuestion(question)
        if (wait !== null)
            return {
                deadline: { kind: "wait", parkKey: wait.parkKey, dueAt: wait.dueAt, waitsFor: wait.on.map((one) => ({ key: one.key, verb: one.verb })) },
                payload: waitPayloadOf(ref, wait),
            }
        const until = parkOfQuestion(question)
        if (until !== null)
            return {
                deadline: { kind: until.loopKey.startsWith(RETRY_PARK_PREFIX) ? "retry" : "round", parkKey: until.parkKey, dueAt: until.dueAt, waitsFor: [] },
                payload: parkPayloadOf(ref, until),
            }
        const stepKey: unknown = typeof question === "object" && question !== null ? Reflect.get(question, "stepKey") : undefined
        if (typeof stepKey !== "string") return null
        const stop = await this.stops.stopOf(ref, stepKey)
        const due = stop?.state === "open" ? await this.deadlines.dueOf(ref, stop) : null
        if (stop === null || due === null) return null
        return {
            deadline: { kind: stop.kind === "approval" ? "approval" : "stop", parkKey: stop.stepKey, dueAt: due.at.toISOString(), waitsFor: [] },
            payload: due.payload,
        }
    }
}
