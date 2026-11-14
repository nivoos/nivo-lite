import { Injectable } from "@nestjs/common"
import type { ClaimedJob } from "@modules/platform/jobs"
import { isModuleJobPayload } from "@modules/queues/module-jobs"
import { moduleKeyOfName } from "@nivo-lite/agent-sdk/schema"
import { DOOR_PORT_ID, WORKFLOW_PORT_ID, type JobContext, type JobDefinition } from "@nivo-lite/agent-sdk/mutation"
import { runDeclaredJob } from "./declared-job.policy"
import { InjectEntityEngineOptions } from "./entity-engine.decorators"
import type { EngineDoorProvider, EngineWorkflowProvider, JobPorts, RunIn } from "./entity-engine.contracts"
import type { EntityEngineOptions } from "./entity-engine.options"
import { EntityEngineService } from "./entity-engine.service"
import { EntityPortsService } from "./entity-ports.service"
import { EntityEngineError, EntityEngineErrorCode } from "./errors/entity-engine.error"
import { ModuleAgentService } from "./module-agent.service"
import { reachesRecords } from "./policies/module-agent.policy"
import type { AgentScope } from "./policies/scoped-tx.contracts"

/** The ports that reach outside the database: a job that lists one runs without a transaction around it. */
const EXTERNAL: ReadonlySet<string> = new Set([DOOR_PORT_ID, WORKFLOW_PORT_ID])

@Injectable()
/**
 * Runs one delivery of the module-jobs queue: finds the declared job by name, parses its input against the declaration, opens the engine
 * scope of the workspace the job was enqueued in and runs it with its ports. A job that reaches records runs FOR its module: the scope
 * carries the module's installed agent of the workspace, so every record the job writes is that agent's; a module with no installed
 * agent has no one to own them, and the job is refused (`AgentMissing`, a failure no retry fixes: the runner dead-letters it). A job that lists
 * the door port calls out, and no transaction spans an external call (BE-PERSISTENCE-6), so its entity and outbox calls each open a
 * scope of their own; every other job runs in one transaction. It catches, classifies and parks nothing: a failure throws to the jobs runner.
 */
export class ModuleJobRunnerService {
    private readonly jobs: ReadonlyMap<string, JobDefinition>

    private door: EngineDoorProvider | null = null

    private workflow: EngineWorkflowProvider | null = null

    constructor(
        private readonly engine: EntityEngineService,
        private readonly ports: EntityPortsService,
        private readonly agents: ModuleAgentService,
        @InjectEntityEngineOptions() private readonly options: EntityEngineOptions,
    ) {
        this.jobs = new Map(this.options.jobs.map((job) => [job.name, job]))
    }

    /** The door capability binds itself here at boot; until it does (an app without one), a job that calls the door fails (the runner dead-letters it). */
    bindDoor(provider: EngineDoorProvider): void {
        this.door = provider
    }

    /** The workflow capability binds itself here at boot; until it does, a job that starts a workflow fails (the runner dead-letters it). */
    bindWorkflow(provider: EngineWorkflowProvider): void {
        this.workflow = provider
    }

    /**
     * Runs the declared job the claimed delivery addresses. A failure is not caught here: the jobs runner (`platform/jobs`) judges it, so
     * a transient one is retried on the job's ladder and any other is a dead letter (the job parks with one item for a person).
     */
    async run(claimed: ClaimedJob): Promise<void> {
        await this.execute(claimed)
    }

    private async execute(claimed: ClaimedJob): Promise<void> {
        const payload = claimed.payload
        if (!isModuleJobPayload(payload))
            throw new EntityEngineError({
                code: EntityEngineErrorCode.JobPayloadInvalid,
                params: { jobId: claimed.jobId },
            })
        const job = this.jobs.get(payload.job)
        if (job === undefined)
            throw new EntityEngineError({ code: EntityEngineErrorCode.JobUnknown, params: { job: payload.job } })
        const parsed = job.input.safeParse(payload.input)
        if (!parsed.success)
            throw new EntityEngineError({ code: EntityEngineErrorCode.JobInputInvalid, params: { job: job.name } })
        const context: JobContext = {
            workspaceId: payload.workspaceId,
            attempt: claimed.fencingToken,
            effectKey: (step) => `${claimed.jobId}:${step}`,
        }
        const agent = reachesRecords(job.ports)
            ? await this.agents.scopeOf(payload.workspaceId, moduleKeyOfName(job.name))
            : undefined
        if (Object.values(job.ports).some((port) => EXTERNAL.has(port.id))) {
            await runDeclaredJob(
                job,
                this.externalPortsOf(job, payload.workspaceId, context, agent, claimed.jobId),
                parsed.data,
                context,
            )
            return
        }
        await this.engine.scoped(
            payload.workspaceId,
            (tx) =>
                runDeclaredJob(
                    job,
                    this.ports.portsFor((use) => use(tx), "job", job.ports),
                    parsed.data,
                    context,
                ),
            agent,
        )
    }

    /**
     * The handles of a job that calls the door or starts a workflow: every entity and outbox call opens a scope of its own, and the
     * door and workflow handles refuse a call made while one is open. An app that registered no provider for a port it lists refuses
     * the job: it can reach nothing out.
     */
    private externalPortsOf(
        job: JobDefinition,
        workspaceId: string,
        context: JobContext,
        agent: AgentScope | undefined,
        jobId: string,
    ): JobPorts {
        let open = 0
        const runIn: RunIn = (use) =>
            this.engine.scoped(
                workspaceId,
                async (tx) => {
                    open += 1
                    try {
                        return await use(tx)
                    } finally {
                        open -= 1
                    }
                },
                agent,
            )
        const scopeOpen = (): boolean => open > 0
        const named = (id: string): ReadonlyArray<string> =>
            Object.entries(job.ports)
                .filter(([, port]) => port.id === id)
                .map(([name]) => name)
        const rest = Object.fromEntries(Object.entries(job.ports).filter(([, port]) => !EXTERNAL.has(port.id)))
        const handles: Record<string, unknown> = {}
        const doorNames = named(DOOR_PORT_ID)
        if (doorNames.length > 0) {
            if (this.door === null)
                throw new EntityEngineError({
                    code: EntityEngineErrorCode.PortUnprovided,
                    params: { id: DOOR_PORT_ID },
                })
            const door = this.door.doorApi({ workspaceId, jobId, agentId: agent?.id, effectKey: context.effectKey, scopeOpen })
            for (const name of doorNames) handles[name] = door
        }
        const workflowNames = named(WORKFLOW_PORT_ID)
        if (workflowNames.length > 0) {
            if (this.workflow === null)
                throw new EntityEngineError({
                    code: EntityEngineErrorCode.PortUnprovided,
                    params: { id: WORKFLOW_PORT_ID },
                })
            const workflow = this.workflow.workflowApi({ workspaceId, scopeOpen })
            for (const name of workflowNames) handles[name] = workflow
        }
        return { ...this.ports.portsFor(runIn, "job", rest), ...handles }
    }
}
