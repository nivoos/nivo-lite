import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { EntityEngineService, type ScopedTx } from "@modules/domain/entity-engine"
import { eachInOrder, isRecord } from "@modules/platform/primitives"
import { AgentRunRecordsService } from "./agent-run-records.service"
import { AgentRunsError, AgentRunsErrorCode } from "./errors/agent-runs.error"
import { runRecordOf, runViewOf } from "./agent-runs.mapper"
import type { RunRecord } from "./agent-runs-records.contracts"
import { RUN_CANCELLED, SETTLE_TRIES } from "./policies/agent-runs.policy"
import { jsonValueOf } from "./policies/json-value.policy"
import type { RunValues, RunWaiterFilter, StoredWaiter } from "./agent-runs-rows.contracts"
import type { RunCancelResult, RunView } from "./agent-runs-engine.contracts"
import type { RunOpen } from "./agent-runs.contracts"

/** What a unit of store work is given: the scope of one workspace. */
type ScopedUse<T> = (tx: ScopedTx) => Promise<T>

const rejected = (): AgentRunsError => new AgentRunsError({ code: AgentRunsErrorCode.ResultRejected })

const iso = (at: Date): string => at.toISOString()

const contextOf = (value: unknown): Readonly<Record<string, unknown>> => {
    const read = jsonValueOf(value)
    if (!read.valid || !isRecord(read.json)) throw rejected()
    return read.json
}

/** The statuses of a run still in flight: it holds its subject. */
const IN_FLIGHT_STATUSES: ReadonlyArray<string> = ["running", "waiting", "parked"]

/**
 * The statuses of a run whose wait an event is asked of: `waiting`, and `running` for the moment between the park's mark and the status
 * the projection writes (the run's own park decides; a resumed run has cleared its mark).
 */
const WAITER_STATUSES: ReadonlyArray<string> = ["running", "waiting"]

/** The engine of thread runs. */
const THREAD_ENGINE = "langgraph"

/** The subject of a run: the kind (its correlation key's scope path) and the id. */
export interface RunSubject {
    /** The kind of the subject: the scope path of its correlation key. */
    readonly kind: string
    /** The id of the subject within its kind. */
    readonly id: string
}

/** A run that holds a subject: its id, its workflow (null for an agent's own graph) and when it started. */
export interface SubjectHolder {
    readonly id: string
    readonly workflowId: string | null
    readonly startedAt: string
}

/** The most parked runs of ONE subject read (one per workflow of the agent in practice; a bound, never a page of the agent's runs). */
const SUBJECT_RUNS_MAX = 20

@Injectable()
/**
 * The runs as the capability opens, reads and cancels them, over the entity engine: one run per wake, the run of a wake, a run by id, and
 * the owner's cancel of a history row. Every method names the workspace: the scope is entered on the caller's transaction (`within`) when
 * one is given, else in a transaction of its own. A write to a run is made under the version it was read at and read again when another
 * writer moved it. The steps of a run are written by the thread projection (agent-threads), never here.
 */
export class AgentRunStoreService {
    constructor(
        @InjectClock() private readonly clock: Clock,
        private readonly engine: EntityEngineService,
        private readonly records: AgentRunRecordsService,
    ) {}

    /** Opens the one run of a wake in `tx`; a wake that already has a run answers it, so a replay opens none. */
    open(tx: EntityManager, input: RunOpen): Promise<RunView> {
        return this.at(input.workspaceId, tx, async (scoped) =>
            runViewOf((await this.records.runOfWake(scoped, input.wakeId)) ?? (await this.insertRun(scoped, input))),
        )
    }

    /**
     * The thread run of a workflow still IN FLIGHT for one subject (running, waiting at a `wait` or a stop, parked), or null: EXACT, by
     * (workspace, workflow, subject) through the partial unique index, however old the run is (no page decides who is found).
     */
    inFlightOf(workspaceId: string, workflowId: string, subject: RunSubject): Promise<RunView | null> {
        return this.at(workspaceId, undefined, async (scoped) => {
            const [row] = await this.records.runRows(
                scoped,
                { workflowId, subject, statuses: IN_FLIGHT_STATUSES, engine: THREAD_ENGINE, order: "started" },
                1,
            )
            const run = row === undefined ? null : await this.records.run(scoped, row.id)
            return run === null ? null : runViewOf(run)
        })
    }

    /**
     * The thread runs IN FLIGHT for one subject, whatever the workflow and the agent, oldest first (at most `SUBJECT_RUNS_MAX`): the runs
     * that hold the subject (rule Q-1). Exact, through the subject columns and the in-flight subject index.
     */
    inFlightOfSubject(workspaceId: string, subject: RunSubject): Promise<ReadonlyArray<SubjectHolder>> {
        return this.at(workspaceId, undefined, async (scoped) => {
            const rows = await this.records.runRows(
                scoped,
                { subject, statuses: IN_FLIGHT_STATUSES, engine: THREAD_ENGINE, order: "started" },
                SUBJECT_RUNS_MAX,
            )
            return [...rows]
                .map((row) => ({ id: row.id, workflowId: row.workflowId, startedAt: row.startedAt }))
                .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id))
        })
    }

    /**
     * The thread runs of an agent PARKED (waiting) for one subject, whatever the workflow, oldest first: where a wait of the subject is
     * looked for first (exact, through the subject columns; no page of the agent's runs decides who is found).
     */
    parkedOfSubject(workspaceId: string, agentId: string, subject: RunSubject): Promise<ReadonlyArray<RunView>> {
        return this.at(workspaceId, undefined, async (scoped) => {
            const rows = await this.records.runRows(
                scoped,
                { agentId, subject, statuses: ["waiting"], engine: THREAD_ENGINE, order: "started" },
                SUBJECT_RUNS_MAX,
            )
            const views: Array<RunView> = []
            await eachInOrder([...rows].reverse(), async (row) => {
                const run = await this.records.run(scoped, row.id)
                if (run !== null) views.push(runViewOf(run))
            })
            return views
        })
    }

    /**
     * The workspace's thread runs IN FLIGHT (running, waiting for a person, parked), newest start first, at most `limit`: the runs one of
     * which may be parked on a deadline (a wait's timeout, an until round or a retry rung, a stop's expiry). Which deadline, if any, is
     * read from the thread itself by its caller (ENGINE-FIN (b): the dev time levers' list, one generic door for every parked deadline).
     */
    inFlightThreads(workspaceId: string, limit: number): Promise<ReadonlyArray<RunView>> {
        return this.at(workspaceId, undefined, async (scoped) => {
            const rows = await this.records.runRows(
                scoped,
                { statuses: IN_FLIGHT_STATUSES, engine: THREAD_ENGINE, order: "started" },
                limit,
            )
            const views: Array<RunView> = []
            await eachInOrder(rows, async (row) => {
                const run = await this.records.run(scoped, row.id)
                if (run !== null) views.push(runViewOf(run))
            })
            return views
        })
    }

    /**
     * Marks the wait a run parks on with the keys an event finds it by (written now, as the run's own index), or clears the mark once
     * the wait has what came (`match` empty). The fence is left as it is.
     */
    markWait(workspaceId: string, runId: string, match: ReadonlyArray<string>): Promise<void> {
        const mark = match.length === 0 ? null : { match, since: iso(this.clock.now()) }
        return this.at(workspaceId, undefined, (scoped) => this.records.markWait(scoped, runId, mark))
    }

    /**
     * The thread runs of the agents, running or waiting, whose parked wait's keys the event's probe names: EVERY such run (exact, through
     * the GIN index on `wait_match`; no page of the agent's runs decides who is found). Unordered: the waits order them.
     */
    waitersOf(
        workspaceId: string,
        filter: Omit<RunWaiterFilter, "statuses" | "engine">,
    ): Promise<ReadonlyArray<StoredWaiter>> {
        return this.at(workspaceId, undefined, (scoped) =>
            this.records.waiters(scoped, { ...filter, statuses: WAITER_STATUSES, engine: THREAD_ENGINE }),
        )
    }

    /** The run of a wake, or null; a producer reads it through the transaction that writes its work. */
    async runOfWake(workspaceId: string, wakeId: string, manager?: EntityManager): Promise<RunView | null> {
        const run = await this.at(workspaceId, manager, (scoped) => this.records.runOfWake(scoped, wakeId))
        return run === null ? null : runViewOf(run)
    }

    /** The run, or null. */
    async runById(workspaceId: string, runId: string, manager?: EntityManager): Promise<RunView | null> {
        const run = await this.at(workspaceId, manager, (scoped) => this.records.run(scoped, runId))
        return run === null ? null : runViewOf(run)
    }

    /**
     * Stops a run that is running or waiting, once: the run is marked cancelled with who and when, and its steps still open are closed
     * failed with `run_cancelled` in the same transaction (`closeOpenSteps`). Steps already done are left as they are: nothing is undone. Only a
     * history row of the old engine comes here (a thread run is cancelled by its stop's skip).
     */
    cancel(workspaceId: string, runId: string, actor: string, manager?: EntityManager): Promise<RunCancelResult> {
        return this.at(workspaceId, manager, async (scoped): Promise<RunCancelResult> => {
            const current = await this.records.run(scoped, runId)
            if (current === null) return { kind: "not_found" }
            if (current.status === "cancelled") return { kind: "already_cancelled" }
            const at = iso(this.clock.now())
            const moved = await this.patchRunWith(scoped, runId, (run) =>
                run.status === "running" || run.status === "waiting"
                    ? {
                          status: "cancelled",
                          error: { code: RUN_CANCELLED },
                          cancelledBy: actor,
                          cancelledAt: at,
                          endedAt: at,
                          waitWorkItemId: null,
                          waitDeadlineAt: null,
                      }
                    : null,
            )
            if (moved === null) return { kind: "not_cancellable" }
            await this.records.closeOpenSteps(scoped, runId, RUN_CANCELLED, at)
            return { kind: "cancelled" }
        })
    }

    /**
     * ENDS, in `tx`, every thread run of any agent IN FLIGHT on one of these subjects, once, WHATEVER its state: at a stop (`waiting`),
     * parked, at a `wait`, on a retry rung or an until round, or running a step now (all `running`). The run is marked cancelled with the
     * typed reason `code` and the moment, its deadline and its wait mark are cleared, and its open step rows are closed with the same
     * `code` in the same transaction (`closeOpenSteps`), so the one-run-per-subject slot is free and nothing of the run reads as running.
     * What comes for it later does nothing by the one ended-run rule (`agent-threads/run-ended.policy`): a rung, a round, a deadline or a
     * decision is refused before it is written, a wake already written is skipped, and a drive still in flight stops at its next step
     * (the step running at this instant ends as it ends; nothing after it runs). What the erasure of a subject (a contact and its routes,
     * a record the erase hid; owner ruling R31 / coordinator ruling R37) calls; answers the runs it ended.
     */
    endInFlightOfSubjects(
        tx: EntityManager,
        workspaceId: string,
        subjects: ReadonlyArray<RunSubject>,
        code: string,
    ): Promise<ReadonlyArray<RunView>> {
        return this.at(workspaceId, tx, async (scoped) => {
            const at = iso(this.clock.now())
            const ended: Array<RunView> = []
            await eachInOrder(subjects, async (subject) => {
                const rows = await this.records.runRows(
                    scoped,
                    { subject, statuses: IN_FLIGHT_STATUSES, engine: THREAD_ENGINE, order: "started" },
                    SUBJECT_RUNS_MAX,
                )
                await eachInOrder(rows, async (row) => {
                    const moved = await this.patchRunWith(scoped, row.id, (run) =>
                        IN_FLIGHT_STATUSES.includes(run.status)
                            ? { status: "cancelled", error: { code }, endedAt: at, waitWorkItemId: null, waitDeadlineAt: null }
                            : null,
                    )
                    if (moved === null) return
                    await this.records.markWait(scoped, row.id, null)
                    await this.records.closeOpenSteps(scoped, row.id, code, at)
                    ended.push(runViewOf(moved))
                })
            })
            return ended
        })
    }

    /** Runs `work` in the scope of the workspace: on `manager` when the caller holds a transaction, else in one of its own. */
    private at<T>(workspaceId: string, manager: EntityManager | undefined, work: ScopedUse<T>): Promise<T> {
        return manager === undefined
            ? this.engine.scoped(workspaceId, work)
            : this.engine.within(manager, workspaceId, work)
    }

    private async insertRun(scoped: ScopedTx, input: RunOpen): Promise<RunRecord> {
        const inserted = await this.records.insertRun(scoped, {
            agentId: input.agentId,
            wakeId: input.wakeId,
            trigger: input.trigger,
            graphVersionId: input.versionId,
            planning: false,
            status: "running",
            context: contextOf(input.context),
            resumeAttempts: 0,
            stepSeq: 0,
            startedAt: iso(this.clock.now()),
            ...(input.subject === undefined || input.subject === null
                ? {}
                : { subjectKind: input.subject.kind, subjectId: input.subject.id }),
        })
        if (inserted !== null) return runRecordOf(inserted)
        const raced = await this.records.runOfWake(scoped, input.wakeId)
        if (raced === null) throw rejected()
        return raced
    }

    /**
     * Reads the run, asks `build` for what to write, writes it under the version read and, when another writer moved the run first, reads
     * and builds again. Answers the run after the write, or null when `build` answered no write.
     */
    private async patchRunWith(
        scoped: ScopedTx,
        runId: string,
        build: (run: RunRecord) => RunValues | null,
        left: number = SETTLE_TRIES,
    ): Promise<RunRecord | null> {
        if (left <= 0) throw new AgentRunsError({ code: AgentRunsErrorCode.RunContended })
        const run = await this.records.run(scoped, runId)
        if (run === null) throw rejected()
        const values = build(run)
        if (values === null) return null
        const written = await this.records.patchRun(scoped, run, values)
        return written ?? this.patchRunWith(scoped, runId, build, left - 1)
    }
}
