import { Injectable, Optional } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AgentRunCancelService } from "@modules/domain/agent-runs"
import { AgentWakeService } from "@modules/domain/agent-work"
import { InjectPrimaryEntityManager } from "@modules/platform/database"
import { WORKFLOW_STOPPED_HELD, WORKFLOW_STOPPED_SKIPPED } from "./agent-graph-flow-runs.service"
import type { WorkflowRunStateWire } from "./policies/workflow-wire.policy"
import type { WorkflowView } from "./agent-workflows.contracts"
import type { AgentRightsAgreed } from "./agent-workflow-rights.contracts"
import type { WorkflowTemplate } from "@nivo-lite/agent-sdk/template"
import { INSTALLED } from "@modules/domain/installed-plugins"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import { AccountAttachmentsService } from "@modules/domain/tool-grants"
import { accountLabelOf, accountsAsNodesName, isNodeMode } from "@modules/domain/tools"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import { WorkspaceMemberSeatsService } from "@modules/domain/workspace-members"
import { WorkspaceEnterpriseService } from "@modules/domain/workspaces"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { eachInOrder } from "@modules/platform/primitives"
import type { GraphActor } from "./agent-graph-admin.service"
import { AgentDirectoryService } from "@modules/domain/agents"
import { storedAvatarAddress } from "@modules/integrations/object-storage"
import { AgentGraphsLogEvent } from "./agent-graphs.log-events"
import { AgentStepTitlesService } from "./agent-step-titles.service"
import { AgentWorkflowInstallService } from "./agent-workflow-install.service"
import { AgentWorkflowRunsService } from "./agent-workflow-runs.service"
import { AgentWorkflowsService } from "./agent-workflows.service"
import type {
    AgentWorkflowGraph,
    RunPinView,
    WorkflowDetail,
    WorkflowEditor,
    WorkflowGraphCall,
    WorkflowGraphEntry,
} from "./agent-workflows.contracts"
import type {
    AgentRightsAgreeRequest,
    AgreedRightsRequest,
    RunPinsRequest,
    TemplateRequest,
    TemplatesRequest,
    WorkflowAcceptRequest,
    WorkflowCreateRequest,
    WorkflowDiffRequest,
    WorkflowRequest,
    WorkflowRollbackRequest,
    WorkflowStatusRequest,
    WorkflowNodeSettingsRequest,
    WorkflowTemplateVersionRequest,
    WorkflowsRequest,
} from "./agent-workflows-door.contracts"
import { AgentGraphsError, AgentGraphsErrorCode } from "./errors/agent-graphs.error"
import { agreedRightsOf, type AgreedRight } from "./policies/node-rights-gate.policy"
import {
    graphWithNodeSettings,
    judgedAccountChoice,
    nodeSettingsViewsOf,
    unsettableRefusal,
    type NodeAccountOption,
    type NodeSettingsChange,
    type NodeSettingsView,
} from "./policies/node-settings.policy"
import { requireNoWidening } from "./policies/workflow-widening.policy"
import {
    diffAgainstOf,
    templateRequired,
    workflowLocaleOf,
    workflowRefused,
    workflowStatusOf,
} from "./policies/workflow-view.policy"
import {
    templatePreviewWireOf,
    templateWireOf,
    workflowDetailWireOf,
    workflowDiffWireOf,
    workflowVersionWireOf,
    workflowWireOf,
    type TemplatePreviewWire,
    type TemplateWire,
    type WorkflowDetailWire,
    type WorkflowDiffWire,
    type WorkflowVersionWire,
    type WorkflowWire,
} from "./policies/workflow-wire.policy"

/** The agent of an installation and the module it runs. */
interface Seat {
    readonly agentId: string
    readonly moduleKey: string
    readonly name: string
}

/** One end hand-off with the picture of the agent it calls. */
export interface WorkflowGraphCallWire extends WorkflowGraphCall {
    /** The picture of the agent that runs the target, or null (the page then shows the module icon). */
    readonly agentAvatar: string | null
}

/** One workflow of the Graph page with its hand-offs pictured. */
export interface WorkflowGraphEntryWire extends Omit<WorkflowGraphEntry, "calls"> {
    /** Its end hand-offs, each with the picture of the agent it calls. */
    readonly calls: ReadonlyArray<WorkflowGraphCallWire>
}

/** The agent Graph page with the display name and the picture of the installed agent. */
export interface AgentWorkflowGraphWire extends Omit<AgentWorkflowGraph, "workflows"> {
    /** The installed agent display name. */
    readonly agentLabel: string
    /** The installed agent picture, or null. */
    readonly agentAvatar: string | null
    /** Every workflow of the agent. */
    readonly workflows: ReadonlyArray<WorkflowGraphEntryWire>
}

/** The entries the owner agreed, as the last argument of a version write: none when the request agreed nothing. */
const agreedOf = (request: AgreedRightsRequest): [] | [ReadonlyArray<AgreedRight>] => {
    const agreed = agreedRightsOf(request.agreedRights)
    return agreed.length === 0 ? [] : [agreed]
}

/** One workflow with its graph and every step's settings: what is settable, what is in force, the accounts it could use. */
export interface WorkflowSettingsDetailWire extends WorkflowDetailWire {
    /** Every step of the running graph, in its order. */
    readonly nodeSettings: ReadonlyArray<NodeSettingsView>
}

/** The status of a connection that works. */
const CONNECTED = "connected"

/** The note of a settings version: the step and what was set on it. */
const noteOf = (nodeKey: string, change: NodeSettingsChange): string => {
    const accounts = change.accounts?.map((one) => one.connectionId).join(",")
    return [
        `${nodeKey}:`,
        ...(change.mode === undefined ? [] : [change.mode]),
        ...(accounts === undefined ? [] : [`accounts ${accounts === "" ? "default" : accounts}`]),
    ].join(" ")
}

@Injectable()
/**
 * The door of the workflows tab and the template pages: every call checks the seat (owner or manager to read or change workflows, any
 * member for the templates and the run pins) and that the workflow belongs to the agent of the installation named, then answers the
 * wire the transport sends. A version that gives the agent more reach (rights, tools or effects its running version does not hold) is
 * the owner's alone to publish, as with the agent graph; one whose nodes ask for more on connected accounts activates only with the
 * owner's agreed list (the rights gate of `AgentWorkflowsService`).
 */
export class AgentWorkflowsAdminService {
    constructor(
        private readonly seats: WorkspaceMemberSeatsService,
        private readonly installations: InstallationRecordsService,
        private readonly workflows: AgentWorkflowsService,
        private readonly runs: AgentWorkflowRunsService,
        private readonly agents: AgentDirectoryService,
        @Optional() private readonly enterprise?: WorkspaceEnterpriseService,
        @Optional() private readonly installer?: AgentWorkflowInstallService,
        @Optional() @InjectLogger() private readonly logger?: Logger,
        @Optional() private readonly titles?: AgentStepTitlesService,
        @Optional() private readonly attachments?: AccountAttachmentsService,
        @Optional() private readonly bindings?: ConnectionBindingsReadService,
        @Optional() private readonly sandbox?: ProviderSandboxService,
        @Optional() private readonly runDoor?: AgentRunCancelService,
        @Optional() private readonly wakes?: AgentWakeService,
        @Optional() @InjectPrimaryEntityManager() private readonly entityManager?: EntityManager,
    ) {}

    /** The title of a step as its installed node declares it; none in an app that installed no nodes. */
    private readonly stepTitleOf = (step: string) => this.titles?.titleOf(step) ?? null

    /** The workflows of the agent of an installation. */
    async list(actor: GraphActor, request: WorkflowsRequest): Promise<ReadonlyArray<WorkflowWire>> {
        await this.editorOf(actor)
        const seat = await this.seatOf(actor, request.installationId)
        await this.installed(actor.workspaceId, request.installationId, seat)
        const views = await this.workflows.list(actor.workspaceId, seat.agentId, workflowLocaleOf(request.locale))
        const wires: Array<WorkflowWire> = []
        await eachInOrder(views, async (view) => {
            wires.push({ ...workflowWireOf(view), runState: await this.runStateOf(actor.workspaceId, view) })
        })
        return wires
    }

    /** What runs and waits for a workflow now: its runs in flight and, for a stop, the events kept or skipped. */
    private async runStateOf(workspaceId: string, view: WorkflowView): Promise<WorkflowRunStateWire | null> {
        if (this.runDoor === undefined || this.wakes === undefined || this.entityManager === undefined) return null
        const wakes = this.wakes
        const [held, skipped] = await this.entityManager.transaction(async (tx) => [
            await wakes.countOfReason(tx, workspaceId, "held", `${WORKFLOW_STOPPED_HELD}${view.id}`),
            await wakes.countOfReason(tx, workspaceId, "skipped", `${WORKFLOW_STOPPED_SKIPPED}${view.id}`),
        ])
        return {
            runsInFlight: await this.runDoor.inFlightCount(workspaceId, view.id),
            holdsEvents: view.stop?.holdsEvents ?? false,
            stoppedAt: view.stop?.at ?? null,
            eventsHeld: held ?? 0,
            eventsSkipped: skipped ?? 0,
        }
    }

    /** The agent Graph page: every workflow of the agent of an installation, the agent named and each cross-agent hand-off naming its target agent. */
    async graph(actor: GraphActor, request: WorkflowsRequest): Promise<AgentWorkflowGraphWire> {
        await this.editorOf(actor)
        const seat = await this.seatOf(actor, request.installationId)
        await this.installed(actor.workspaceId, request.installationId, seat)
        const graph = await this.workflows.graphOf(actor.workspaceId, seat.agentId, workflowLocaleOf(request.locale))
        const targets = new Set(
            graph.workflows.flatMap((workflow) =>
                workflow.calls.filter((call) => call.crossAgent).map((call) => call.agent),
            ),
        )
        const found = await Promise.all(
            [...targets].map(async (moduleKey) => ({
                moduleKey,
                target: await this.installations.firstOfModule(actor.workspaceId, moduleKey),
            })),
        )
        const agentIds = [seat.agentId, ...found.flatMap(({ target }) => (target?.agentId ? [target.agentId] : []))]
        const avatars = new Map(
            (await this.agents.identitiesOf(actor.workspaceId, agentIds)).map((card) => [
                card.id,
                storedAvatarAddress(card.avatarUrl),
            ]),
        )
        const targetOf = new Map(found.map(({ moduleKey, target }) => [moduleKey, target]))
        const labelled = (call: WorkflowGraphCall): WorkflowGraphCallWire => {
            const target = call.crossAgent ? (targetOf.get(call.agent) ?? null) : null
            const name = target?.name.trim() ?? ""
            return {
                ...call,
                agentLabel: name === "" ? call.agentLabel : (target?.name ?? call.agentLabel),
                agentAvatar: target?.agentId ? (avatars.get(target.agentId) ?? null) : null,
            }
        }
        return {
            ...graph,
            agentLabel: seat.name,
            agentAvatar: avatars.get(seat.agentId) ?? null,
            workflows: graph.workflows.map((workflow) => ({ ...workflow, calls: workflow.calls.map(labelled) })),
        }
    }

    /**
     * One workflow with its graph, its history, how it differs from its template, and every step's NODE SETTINGS (`node-settings.policy`):
     * what the shop may set on it, what is in force, and the agent's attached accounts the step could use (default and sandbox marked).
     */
    async detail(actor: GraphActor, request: WorkflowRequest): Promise<WorkflowSettingsDetailWire> {
        await this.editorOf(actor)
        const detail = await this.owned(actor, request)
        const attached = await this.accountOptionsOf(actor.workspaceId, detail.workflow.agentId)
        const wire = workflowDetailWireOf(detail, this.stepTitleOf)
        return {
            ...wire,
            workflow: { ...wire.workflow, runState: await this.runStateOf(actor.workspaceId, detail.workflow) },
            nodeSettings: nodeSettingsViewsOf(detail.graph, attached),
        }
    }

    /** How one version differs from another, from the one before or from a template version. */
    async diff(actor: GraphActor, request: WorkflowDiffRequest): Promise<WorkflowDiffWire> {
        await this.editorOf(actor)
        await this.owned(actor, request)
        const against = diffAgainstOf(request.against, request.againstNumber ?? null)
        return workflowDiffWireOf(
            await this.workflows.versionDiff(actor.workspaceId, request.workflowId, request.number, against),
            this.stepTitleOf,
        )
    }

    /** What accepting a newer template version would write; nothing is written. */
    async templatePreview(actor: GraphActor, request: WorkflowTemplateVersionRequest): Promise<TemplatePreviewWire> {
        await this.editorOf(actor)
        await this.owned(actor, request)
        const locale = workflowLocaleOf(request.locale)
        return templatePreviewWireOf(
            await this.workflows.templatePreview(
                actor.workspaceId,
                request.workflowId,
                request.templateVersion,
                locale,
            ),
            this.stepTitleOf,
        )
    }

    /** Adds a workflow from a template version (the newest when none is named): a stored graph is exactly an installed template version. */
    async create(actor: GraphActor, request: WorkflowCreateRequest): Promise<WorkflowWire> {
        const author = await this.editorOf(actor)
        const seat = await this.seatOf(actor, request.installationId)
        await this.openTemplate(actor.workspaceId, request.templateId)
        const pick = { templateId: request.templateId, version: request.templateVersion ?? null }
        const locale = workflowLocaleOf(request.locale)
        return workflowWireOf(await this.workflows.createFromTemplate(actor.workspaceId, seat.agentId, pick, author, locale))
    }

    /**
     * THE ONE DOOR of a node's settings (`node-settings.policy`; rights rule 5, templates R89), for the OWNER alone: ONE node step of the
     * workflow's running graph gets the settings asked (its mode `auto | ask`, the accounts it uses in try order; a member not asked is
     * left), each judged by rule: the step must take it (`NODE_SETTING_UNSETTABLE`), the mode must be a mode (`mode`), every chosen
     * account must be attached to the agent, working, of a provider the step lists, a sandbox one only while the sandbox is on, and named
     * once (`judgedAccountChoice`); an empty choice goes back to the default pick. It writes a NEW version of the workflow through the
     * judged road (`requireSoundFlow`: still the template's copy, an `ask` step calls one write `NODE_ASK_WRITES_MANY`), so the history
     * shows it and a run pins it; runs in flight keep the version they started on. Settings already in force write nothing and answer the
     * running version. Refused, typed: a manager or staff (`FORBIDDEN`), a key no node has (`node`), a newer version than the one read.
     */
    async setNodeSettings(actor: GraphActor, request: WorkflowNodeSettingsRequest): Promise<WorkflowVersionWire> {
        const author = await this.editorOf(actor)
        if (author.role !== "owner") throw new AgentGraphsError({ code: AgentGraphsErrorCode.Forbidden })
        const mode = request.mode ?? undefined
        if (mode !== undefined && !isNodeMode(mode)) throw workflowRefused("mode")
        const detail = await this.owned(actor, request)
        const node = detail.graph.nodes.find((one) => one.key === request.nodeKey)
        if (node === undefined) throw workflowRefused("node")
        const wanted = request.accountIds ?? undefined
        const attached = wanted === undefined ? [] : await this.accountOptionsOf(actor.workspaceId, detail.workflow.agentId)
        const sandboxOn = this.sandbox?.enabled() === true
        const change: NodeSettingsChange = {
            ...(mode === undefined ? {} : { mode }),
            ...(wanted === undefined ? {} : { accounts: judgedAccountChoice(node, wanted, attached, sandboxOn) }),
        }
        const graph = graphWithNodeSettings(detail.graph, request.nodeKey, change, unsettableRefusal)
        if (graph === null) {
            const running = detail.versions.find((version) => version.active)
            if (running === undefined) throw workflowRefused("version")
            return workflowVersionWireOf(running)
        }
        const expected = request.expectedLatest ?? null
        const note = noteOf(request.nodeKey, change)
        return workflowVersionWireOf(
            await this.workflows.publish(actor.workspaceId, request.workflowId, graph, author, expected, note),
        )
    }

    /**
     * The agent's attached accounts as a step's choice reads them: under the provider key nodes name each by, with its label, whether it
     * works, is a sandbox one and is the agent's default of its provider. None in an app that reads no attachments.
     */
    private async accountOptionsOf(workspaceId: string, agentId: string): Promise<ReadonlyArray<NodeAccountOption>> {
        const { attachments, bindings } = this
        if (attachments === undefined) return []
        const attached = await attachments.listOfAgent(workspaceId, agentId)
        const named = await accountsAsNodesName(workspaceId, attached, bindings)
        const options: Array<NodeAccountOption> = []
        await eachInOrder(named, async (account) => {
            const record = (await bindings?.recordOf(workspaceId, account.connectionId)) ?? null
            options.push({
                connectionId: account.connectionId,
                provider: account.provider,
                label: record === null ? account.connectionId : accountLabelOf(record.provider, record.name, record.meta),
                connected: record?.status === CONNECTED,
                sandbox: record?.sandbox === true,
                isDefault: attached.some((row) => row.connectionId === account.connectionId && row.isDefault === true),
            })
        })
        return options
    }

    /** Rolls the workflow back to an older version, as a new version. */
    async rollback(actor: GraphActor, request: WorkflowRollbackRequest): Promise<WorkflowVersionWire> {
        const author = await this.editorOf(actor)
        const detail = await this.owned(actor, request)
        const target = await this.workflows.versionDiff(actor.workspaceId, request.workflowId, request.number, {
            kind: "previous",
        })
        requireNoWidening(detail.graph, target.after, author.role)
        const expected = request.expectedLatest ?? null
        return workflowVersionWireOf(
            await this.workflows.rollback(
                actor.workspaceId,
                request.workflowId,
                request.number,
                author,
                expected,
                request.note,
                ...agreedOf(request),
            ),
        )
    }

    /** Accepts a newer version of the workflow's template, as a new version, after the owner reviewed the preview. */
    async acceptTemplate(actor: GraphActor, request: WorkflowAcceptRequest): Promise<WorkflowVersionWire> {
        const author = await this.editorOf(actor)
        await this.owned(actor, request)
        const { workspaceId } = actor
        const preview = await this.workflows.templatePreview(
            workspaceId,
            request.workflowId,
            request.templateVersion,
            "vi",
        )
        requireNoWidening(preview.current, preview.merged, author.role)
        const expected = request.expectedLatest ?? null
        return workflowVersionWireOf(
            await this.workflows.acceptTemplate(
                workspaceId,
                request.workflowId,
                request.templateVersion,
                author,
                expected,
                request.note,
                ...agreedOf(request),
            ),
        )
    }

    /**
     * Moves the workflow to `active`, `draft` or `paused`. A STOP (`paused`) keeps the person's choice for the events that come while
     * stopped (held for the start, or recorded and reported once) and, when asked, ends every run of it in flight through the run door;
     * runs in flight otherwise go on. A START (`active` from `paused`) releases the events held while stopped, in the order they came.
     */
    async setStatus(actor: GraphActor, request: WorkflowStatusRequest): Promise<boolean> {
        const editor = await this.editorOf(actor)
        await this.owned(actor, request)
        const status = workflowStatusOf(request.status)
        const { workspaceId } = actor
        // Turning a workflow on activates its running version: what it asks beyond its grant rows needs the owner's agreed list first.
        if (status === "active" && editor.memberId !== null) {
            const agreed = agreedRightsOf(request.agreedRights)
            const consent = { memberId: editor.memberId, role: editor.role, agreed }
            await this.workflows.requireRights(workspaceId, request.workflowId, consent)
        }
        const stop =
            status === "paused"
                ? { holdsEvents: request.holdEvents === true, at: new Date().toISOString(), by: editor.memberId }
                : undefined
        const before = await this.workflows.setStatus(workspaceId, request.workflowId, status, stop)
        if (status === "paused" && request.endRuns === true)
            await this.runDoor?.endAllOfWorkflow({ principalId: actor.principalId, workspaceId, workflowId: request.workflowId })
        if (status === "active" && before === "paused" && this.wakes !== undefined && this.entityManager !== undefined) {
            const wakes = this.wakes
            await this.entityManager.transaction((tx) =>
                wakes.releaseHeld(tx, workspaceId, `${WORKFLOW_STOPPED_HELD}${request.workflowId}`),
            )
        }
        return true
    }

    /**
     * The road of the REMOVED rights agreement (nivo-frame `rights`: no rights-upgrade gate, nothing to agree): it agrees nothing and
     * answers so. What stays on it is no right: the OWNER picks the one source of each stream two attached accounts read (`triggerPicks`,
     * owner key `triggerOneSource2026_11_12`): every pick is checked first (`TRIGGER_PICK_REFUSED` refuses the call, nothing written), a
     * manager's pick is refused `FORBIDDEN`.
     */
    async agreeRights(actor: GraphActor, request: AgentRightsAgreeRequest): Promise<AgentRightsAgreed> {
        const editor = await this.editorOf(actor)
        const seat = await this.seatOf(actor, request.installationId)
        const picks = request.triggerPicks ?? []
        if (picks.length > 0 && (editor.role !== "owner" || editor.memberId === null))
            throw new AgentGraphsError({ code: AgentGraphsErrorCode.Forbidden })
        const checked = await this.runs.triggerPicksOf(actor.workspaceId, seat.agentId, picks)
        if (checked.length > 0 && editor.memberId !== null)
            await this.runs.recordTriggerPicks(actor.workspaceId, seat.agentId, editor.memberId, checked)
        return { nodeRightsDecide: true, agreed: 0 }
    }

    /** The workflow templates of the market, of one module or of all, for any member of the workspace. */
    async templates(actor: GraphActor, request: TemplatesRequest): Promise<ReadonlyArray<TemplateWire>> {
        await this.memberOf(actor)
        const locale = workflowLocaleOf(request.locale)
        const listed = request.moduleKey == null ? INSTALLED.templates() : INSTALLED.templatesOf(request.moduleKey)
        // A template of a private plugin is listed only to the enterprise workspaces the plugin names.
        const open = await Promise.all(listed.map((template) => this.opens(actor.workspaceId, template.moduleKey)))
        return listed.filter((_, at) => open[at] === true).map((template) => templateWireOf(template, locale))
    }

    /** One workflow template, for any member of the workspace. */
    async template(actor: GraphActor, request: TemplateRequest): Promise<TemplateWire> {
        await this.memberOf(actor)
        return templateWireOf(
            await this.openTemplate(actor.workspaceId, request.templateId),
            workflowLocaleOf(request.locale),
        )
    }

    /**
     * Whether the workspace may use what a module ships: always for a module of a public plugin (no read); for a module of a private
     * plugin only when the workspace's enterprise identifier is one the plugin names. An app without the workspaces capability
     * opens no private module.
     */
    private async opens(workspaceId: string, moduleKey: string): Promise<boolean> {
        if (INSTALLED.isOpenTo(moduleKey, null)) return true
        return (await this.enterprise?.opens(workspaceId, moduleKey)) ?? false
    }

    /** The template of this id as the workspace may use it; one of a module closed to the workspace is the not-found of an unknown id. */
    private async openTemplate(workspaceId: string, templateId: string): Promise<WorkflowTemplate> {
        const template = templateRequired(templateId)
        // An unknown id and a closed template answer the same refusal: nothing tells a private template from no template.
        if (!(await this.opens(workspaceId, template.moduleKey))) return templateRequired("")
        return template
    }

    /** The workflow and version each of these runs of the installation's agent executes, for any member of the workspace. */
    async runPins(actor: GraphActor, request: RunPinsRequest): Promise<ReadonlyArray<RunPinView>> {
        await this.memberOf(actor)
        await this.seatOf(actor, request.installationId)
        return this.runs.pinsOf(actor.workspaceId, request.runIds)
    }

    /**
     * Before the workflows of an agent are listed, the agent is given the ones its plugin ships where it holds none: how an agent
     * installed before the install doors made them (or through a door that makes none) is repaired the first time an owner or a
     * manager opens its workflows. It changes nothing for an agent that holds them; a failure is logged and the page is answered.
     */
    private async installed(workspaceId: string, installationId: string, seat: Seat): Promise<void> {
        const made = { workspaceId, agentId: seat.agentId, installationId, moduleKey: seat.moduleKey }
        try {
            await this.installer?.install(made)
        } catch (cause: unknown) {
            if (this.logger === undefined) throw cause
            this.logger.error(AgentGraphsLogEvent.WorkflowInstallFailed, cause, made)
        }
    }

    private async owned(actor: GraphActor, request: WorkflowRequest): Promise<WorkflowDetail> {
        const seat = await this.seatOf(actor, request.installationId)
        const detail = await this.workflows.detail(
            actor.workspaceId,
            request.workflowId,
            workflowLocaleOf(request.locale),
        )
        if (detail.workflow.agentId !== seat.agentId) {
            throw new AgentGraphsError({ code: AgentGraphsErrorCode.WorkflowNotFound })
        }
        return detail
    }

    private async seatOf(actor: GraphActor, installationId: string): Promise<Seat> {
        const installation = await this.installations.find(actor.workspaceId, installationId)
        if (!installation?.agentId) throw new AgentGraphsError({ code: AgentGraphsErrorCode.GraphNotFound })
        return { agentId: installation.agentId, moduleKey: installation.moduleKey, name: installation.name }
    }

    private async memberOf(actor: GraphActor): Promise<void> {
        const seat = await this.seats.activeSeatOfUser(actor.workspaceId, actor.principalId)
        if (seat === null) throw new AgentGraphsError({ code: AgentGraphsErrorCode.Forbidden })
    }

    private async editorOf(actor: GraphActor): Promise<WorkflowEditor> {
        const seat = await this.seats.activeSeatOfUser(actor.workspaceId, actor.principalId)
        if (seat === null || (seat.role !== "owner" && seat.role !== "manager"))
            throw new AgentGraphsError({ code: AgentGraphsErrorCode.Forbidden })
        return { kind: "owner", memberId: seat.memberId, role: seat.role }
    }
}
