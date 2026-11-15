import { Injectable } from "@nestjs/common"
import { WorkspaceMembersService, type WorkspaceRole } from "@modules/domain/workspace-members"
import { AgentRunStoreService } from "./agent-run-store.service"
import { RUN_ENDED_BY_PERSON } from "./policies/agent-runs.policy"
import type {
    OwnerEndAnswer,
    OwnerEndRequest,
    OwnerPauseAnswer,
    OwnerRunRequest,
    RunByPerson,
    RunDoorHooks,
    RunView,
} from "./agent-runs-engine.contracts"

/** The seats that may end, pause or resume a run: the people who govern the workspace's agents. */
const GOVERNORS: ReadonlyArray<WorkspaceRole> = ["owner", "manager"]

/** The subject kinds of a customer conversation, as the delivery keys runs: the route, and the person. */
const ROUTE_SUBJECT = "routeId"
const CONTACT_SUBJECT = "contactId"

/** The most runs of one workflow a person's "end them all" ends in one press (a bound, never a page decides more). */
const WORKFLOW_RUNS_MAX = 200

/** What ending every run of a workflow in flight did. */
export interface WorkflowRunsEnded {
    /** How many runs ended now. */
    readonly ended: number
}

@Injectable()
/**
 * THE RUN DOOR of a person (owner or manager): END a run in flight, whatever its state (running a step, at a `wait`, on a retry rung or an
 * until round, at a stop or an approval, paused, with a child in flight), PAUSE it, RESUME it. One door for every caller (the run page,
 * the agent's room, the customer's conversation, the workbench, the workflow page). The write is the store's one row-ending
 * (`AgentRunStoreService.endRun`, the same the erasure of a subject uses) with the end reason `ended_by_person` and the member; once it
 * committed, the thread engine's hooks (`RunDoorHooks`, registered at start) close what the run held (its stops and their cards, the
 * wakes held behind it are released to the next run), end its children in flight through this same door, and tell the team once. It
 * never messages the customer by itself: only when the person ticked "tell the customer", the agent's model words one line and it goes
 * through the normal send door. It never undoes what steps already sent or did. A run of another workspace answers as one that does not
 * exist. Idempotent: a second end answers `already_ended`, a second pause `already_paused`.
 */
export class AgentRunCancelService {
    private hooks: RunDoorHooks | null = null

    constructor(
        private readonly members: WorkspaceMembersService,
        private readonly runs: AgentRunStoreService,
    ) {}

    /** Registers the thread engine's after-write hooks once the app has started. */
    setHooks(hooks: RunDoorHooks): void {
        this.hooks = hooks
    }

    /** Ends the run for an owner or manager of its workspace; refused for any other seat. */
    async cancel(request: OwnerEndRequest): Promise<OwnerEndAnswer> {
        const by = await this.personOf(request)
        return this.endAs(by, request.workspaceId, request.runId, request.tellCustomer)
    }

    /** Pauses the run for an owner or manager: it takes no further step and no wake until resumed; it keeps its subject. */
    async pause(request: OwnerRunRequest): Promise<OwnerPauseAnswer> {
        const by = await this.personOf(request)
        const result = await this.runs.pauseRun(request.workspaceId, request.runId, by.memberId)
        if (result.kind === "paused" && result.run !== null) await this.hooks?.paused({ run: result.run, ...by })
        return { kind: result.kind }
    }

    /** Resumes a run a person paused: the wakes held while it was paused run in the order they came. */
    async resume(request: OwnerRunRequest): Promise<OwnerPauseAnswer> {
        const by = await this.personOf(request)
        const result = await this.runs.resumePausedRun(request.workspaceId, request.runId, by.memberId)
        if (result.kind === "resumed" && result.run !== null) await this.hooks?.resumed({ run: result.run, ...by })
        return { kind: result.kind }
    }

    /** Ends every run of the workflow in flight (the workflow page's "end them all", and "stop and end them"), each through the one end. */
    async endAllOfWorkflow(request: Omit<OwnerRunRequest, "runId"> & { readonly workflowId: string }): Promise<WorkflowRunsEnded> {
        const by = await this.personOf({ ...request, runId: "" })
        const runs = await this.runs.inFlightOfWorkflow(request.workspaceId, request.workflowId, WORKFLOW_RUNS_MAX)
        let ended = 0
        for (const run of runs) {
            const answer = await this.endAs(by, request.workspaceId, run.id, false)
            if (answer.kind === "ended") ended += 1
        }
        return { ended }
    }

    /**
     * The runs in flight that serve one customer conversation (a route): every run whose subject is that route or that route's person,
     * whatever its workflow, oldest first. What the conversation view offers End / Pause on. Any member of the workspace may read it.
     */
    async inFlightOfRoute(
        principalId: string,
        workspaceId: string,
        routeId: string,
        contactId: string | null,
    ): Promise<ReadonlyArray<RunView>> {
        await this.members.require(principalId, workspaceId)
        const subjects = [{ kind: ROUTE_SUBJECT, id: routeId }, ...(contactId === null ? [] : [{ kind: CONTACT_SUBJECT, id: contactId }])]
        const seen = new Set<string>()
        const runs: Array<RunView> = []
        for (const subject of subjects) {
            for (const holder of await this.runs.inFlightOfSubject(workspaceId, subject)) {
                if (seen.has(holder.id)) continue
                seen.add(holder.id)
                const run = await this.runs.runById(workspaceId, holder.id)
                if (run !== null) runs.push(run)
            }
        }
        return runs
    }

    /** How many runs of the workflow are in flight (the confirm dialogs' count). */
    async inFlightCount(workspaceId: string, workflowId: string): Promise<number> {
        return (await this.runs.inFlightOfWorkflow(workspaceId, workflowId, WORKFLOW_RUNS_MAX)).length
    }

    /**
     * Ends one run as a person already allowed to (the hooks end a parent's children in flight through here): the store's one row-ending,
     * then the hooks once the write committed. Answers as the door does.
     */
    async endAs(by: Omit<RunByPerson, "run">, workspaceId: string, runId: string, tellCustomer: boolean): Promise<OwnerEndAnswer> {
        const result = await this.runs.endRun(workspaceId, runId, RUN_ENDED_BY_PERSON, by.memberId)
        if (result.kind !== "ended" || result.run === null) return { kind: result.kind, note: null, children: 0 }
        const after = await this.afterEnd({ run: result.run, ...by }, tellCustomer)
        return { kind: "ended", note: "effects_kept", children: after }
    }

    private async afterEnd(done: RunByPerson, tellCustomer: boolean): Promise<number> {
        if (this.hooks === null) return 0
        return (await this.hooks.ended(done, tellCustomer)).children
    }

    /** The member asking, refused (typed) for any seat but an owner or a manager; a run of another workspace is checked by the store. */
    private async personOf(request: OwnerRunRequest): Promise<Omit<RunByPerson, "run">> {
        const member = await this.members.require(request.principalId, request.workspaceId, GOVERNORS)
        return { memberId: await this.members.idOf(request.principalId, request.workspaceId), name: member.displayName }
    }
}

export type { RunView }
