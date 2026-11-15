import { Injectable } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { InjectClock, type Clock } from "@modules/platform/clock"
import { EntityEngineService, type ScopedTx } from "@modules/domain/entity-engine"
import { eachInOrder, isRecord } from "@modules/platform/primitives"
import { AgentRunRecordsService } from "./agent-run-records.service"
import { AgentRunsError, AgentRunsErrorCode } from "./errors/agent-runs.error"
import { runRecordOf, runViewOf } from "./agent-runs.mapper"
import type { RunRecord } from "./agent-runs-records.contracts"
import { RUN_PAUSED_BY_PERSON, SETTLE_TRIES } from "./policies/agent-runs.policy"
import { jsonValueOf } from "./policies/json-value.policy"
import type { RunValues, RunWaiterFilter, StoredRun, StoredWaiter } from "./agent-runs-rows.contracts"
import type { RunEndResult, RunPauseResult, RunView } from "./agent-runs-engine.contracts"
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

/** The statuses a person may pause a run in: it runs or waits (a parked run is already paused). */
const PAUSABLE_STATUSES: ReadonlyArray<string> = ["running", "waiting"]

/** True when a stored run is parked by a person's pause. */
const isPausedRow = (run: Pick<StoredRun, "status" | "parkReason">): boolean =>
    run.status === "parked" && run.parkReason === RUN_PAUSED_BY_PERSON

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
     * THE END OF ONE RUN BY A PERSON, in any state of a run in flight (running a step, at a `wait`, on a retry rung or an until round,
     * at a stop, paused): the ONE row-ending the erasure of a subject uses too (`endedRow`). The run is marked cancelled with the typed
     * end reason `code`, the member and the moment; its deadline and wait mark are cleared and its open step rows are closed with the
     * same code, in one transaction. Idempotent: a run already ended answers `already_ended` and nothing is written. What comes for it
     * later does nothing by the one ended-run rule (`agent-threads/run-ended.policy`): the step running at this instant finishes its act,
     * nothing after it runs. Every engine, so no row is left that no door can close.
     */
    endRun(workspaceId: string, runId: string, code: string, by: string, manager?: EntityManager): Promise<RunEndResult> {
        return this.at(workspaceId, manager, async (scoped): Promise<RunEndResult> => {
            const current = await this.records.run(scoped, runId)
            if (current === null) return { kind: "not_found", run: null }
            if (!IN_FLIGHT_STATUSES.includes(current.status)) return { kind: "already_ended", run: runViewOf(current) }
            const ended = await this.endedRow(scoped, runId, code, by, iso(this.clock.now()))
            return ended === null ? { kind: "already_ended", run: await this.viewOf(scoped, runId) } : { kind: "ended", run: ended }
        })
    }

    /**
     * A PERSON PAUSES a run in flight (running or waiting): status `parked`, `park_reason` = `paused_by_person`; the error member keeps
     * who, when, and the status and error it had, so the resume puts them back. A parked run is in flight: it keeps its subject. It takes
     * no further step and runs no wake until it is resumed (the thread wakes hold every wake of it `paused:<run>`; a step visit of it
     * stops the drive before the step). Idempotent.
     */
    pauseRun(workspaceId: string, runId: string, by: string): Promise<RunPauseResult> {
        return this.at(workspaceId, undefined, async (scoped): Promise<RunPauseResult> => {
            const row = await this.records.runRow(scoped, runId)
            if (row === null) return { kind: "not_found", run: null }
            if (isPausedRow(row)) return { kind: "already_paused", run: await this.viewOf(scoped, runId) }
            if (!PAUSABLE_STATUSES.includes(row.status)) return { kind: "already_ended", run: await this.viewOf(scoped, runId) }
            const at = iso(this.clock.now())
            const moved = await this.patchRowWith(scoped, runId, (run) =>
                PAUSABLE_STATUSES.includes(run.status) && !isPausedRow(run)
                    ? {
                          status: "parked",
                          parkReason: RUN_PAUSED_BY_PERSON,
                          error: { code: RUN_PAUSED_BY_PERSON, by, at, was: run.status, wasError: run.error },
                      }
                    : null,
            )
            return { kind: moved === null ? "already_paused" : "paused", run: await this.viewOf(scoped, runId) }
        })
    }

    /** A PERSON RESUMES a run a person paused: its status and error before the pause come back, with who resumed it and when. */
    resumePausedRun(workspaceId: string, runId: string, by: string): Promise<RunPauseResult> {
        return this.at(workspaceId, undefined, async (scoped): Promise<RunPauseResult> => {
            const row = await this.records.runRow(scoped, runId)
            if (row === null) return { kind: "not_found", run: null }
            if (!isPausedRow(row))
                return {
                    kind: IN_FLIGHT_STATUSES.includes(row.status) ? "not_paused" : "already_ended",
                    run: await this.viewOf(scoped, runId),
                }
            const at = iso(this.clock.now())
            const moved = await this.patchRowWith(scoped, runId, (run) => {
                if (!isPausedRow(run)) return null
                const was = run.error?.["was"]
                const wasError = run.error?.["wasError"]
                return {
                    status: was === "waiting" ? "waiting" : "running",
                    parkReason: null,
                    error: isRecord(wasError) ? wasError : null,
                    resumedAt: at,
                    resumedBy: by,
                    resumeReason: RUN_PAUSED_BY_PERSON,
                }
            })
            return { kind: moved === null ? "not_paused" : "resumed", run: await this.viewOf(scoped, runId) }
        })
    }

    /** The thread runs of one workflow in flight (running, waiting, parked), oldest first, at most `limit`. */
    inFlightOfWorkflow(workspaceId: string, workflowId: string, limit: number): Promise<ReadonlyArray<RunView>> {
        return this.at(workspaceId, undefined, async (scoped) => {
            const rows = await this.records.runRows(
                scoped,
                { workflowId, statuses: IN_FLIGHT_STATUSES, engine: THREAD_ENGINE, order: "started" },
                limit,
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
     * ENDS, in `tx`, every thread run of any agent IN FLIGHT on one of these subjects, once, WHATEVER its state, with the typed reason
     * `code` and no member (the erasure of a subject, owner ruling R31 / coordinator ruling R37): the same row-ending as a person's end
     * (`endedRow`). Answers the runs it ended.
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
                    const run = await this.endedRow(scoped, row.id, code, null, at)
                    if (run !== null) ended.push(run)
                })
            })
            return ended
        })
    }

    /**
     * The ONE row-ending of a run in flight: cancelled with `code` (and the member, when a person ended it), the moment, the park, the
     * deadline and the wait mark cleared, the open step rows closed with the same code. Null when the run was no longer in flight.
     */
    private async endedRow(scoped: ScopedTx, runId: string, code: string, by: string | null, at: string): Promise<RunView | null> {
        const moved = await this.patchRunWith(scoped, runId, (run) =>
            IN_FLIGHT_STATUSES.includes(run.status)
                ? {
                      status: "cancelled",
                      error: { code },
                      endedAt: at,
                      cancelledAt: at,
                      ...(by === null ? {} : { cancelledBy: by }),
                      parkReason: null,
                      waitWorkItemId: null,
                      waitDeadlineAt: null,
                  }
                : null,
        )
        if (moved === null) return null
        await this.records.markWait(scoped, runId, null)
        await this.records.closeOpenSteps(scoped, runId, code, at)
        return runViewOf(moved)
    }

    private async viewOf(scoped: ScopedTx, runId: string): Promise<RunView | null> {
        const run = await this.records.run(scoped, runId)
        return run === null ? null : runViewOf(run)
    }

    /** As `patchRunWith`, on the stored row (its error member whole), for the pause and its resume. */
    private async patchRowWith(
        scoped: ScopedTx,
        runId: string,
        build: (run: StoredRun) => RunValues | null,
        left: number = SETTLE_TRIES,
    ): Promise<StoredRun | null> {
        if (left <= 0) throw new AgentRunsError({ code: AgentRunsErrorCode.RunContended })
        const run = await this.records.runRow(scoped, runId)
        if (run === null) throw rejected()
        const values = build(run)
        if (values === null) return null
        const written = await this.records.patchRunRow(scoped, run, values)
        return written ?? this.patchRowWith(scoped, runId, build, left - 1)
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
