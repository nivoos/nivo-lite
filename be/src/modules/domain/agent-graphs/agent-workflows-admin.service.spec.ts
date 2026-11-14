import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { AgentDirectoryService } from "@modules/domain/agents"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import type { InstallationRecord } from "@modules/domain/module-installations"
import { WorkspaceMemberSeatsService } from "@modules/domain/workspace-members"
import type { MemberSeatRecord } from "@modules/domain/workspace-members"
import { ConnectionBindingsReadService, type ConnectionRecord } from "@modules/domain/connections"
import { ProviderSandboxService } from "@modules/domain/provider-sandbox"
import { AccountAttachmentsService } from "@modules/domain/tool-grants"
import { AgentWorkflowRunsService } from "./agent-workflow-runs.service"
import { AgentWorkflowsAdminService } from "./agent-workflows-admin.service"
import { AgentWorkflowsService } from "./agent-workflows.service"
import type {
    AgentWorkflowGraph,
    TemplatePreview,
    WorkflowDetail,
    WorkflowDiff,
    WorkflowVersionView,
    WorkflowView,
} from "./agent-workflows.contracts"
import { AgentGraphsErrorCode } from "./errors/agent-graphs.error"

type Role = "owner" | "manager" | "staff"

const ACTOR = { workspaceId: "ws-1", principalId: "user-1" }

const GRAPH: GraphSpec = {
    schema: "nivo/agent-graph@1",
    moduleKey: "booking",
    trigger: { kind: "tag", sources: ["schedule"] },
    grant: { tools: [], effects: [] },
    nodes: [{ key: "end", kind: "output", step: "stop" }],
}

const WIDER: GraphSpec = { ...GRAPH, grant: { ...GRAPH.grant, tools: ["nivo.tool.ledger.entry.append"] } }

const VIEW: WorkflowView = {
    id: "wf-1",
    agentId: "agent-1",
    key: "reports",
    name: "Reports",
    status: "draft",
    primary: false,
    activeNumber: 1,
    latestNumber: 1,
    template: null,
    templateName: null,
    templateLatest: null,
    templateChangedSteps: null,
    stepCount: 1,
    updatedAt: "2026-11-09T02:00:00.000Z",
}

const VERSION: WorkflowVersionView = {
    id: "wfv-2",
    number: 2,
    changeKind: "edit",
    authorKind: "owner",
    authorId: "member-1",
    note: "",
    template: null,
    fromNumber: null,
    publishedAt: "2026-11-09T02:00:00.000Z",
    stepCount: 1,
    changedSteps: 0,
    active: true,
}

const DETAIL: WorkflowDetail = { workflow: VIEW, graph: GRAPH, versions: [VERSION], templateDiff: null }

const NO_DIFF: WorkflowDiff = {
    steps: [],
    triggerChanged: false,
    grant: {
        toolsAdded: [],
        toolsRemoved: [],
        effectsAdded: [],
        effectsRemoved: [],
    },
}

/** A template preview whose merge holds `merged` over the workflow's `current`. */
const previewOf = (current: GraphSpec, merged: GraphSpec): TemplatePreview => ({
    templateVersion: 2,
    changes: [],
    current,
    merged,
    diff: NO_DIFF,
    conflicts: [],
})

type AgentIdentityCard = Awaited<ReturnType<AgentDirectoryService["identitiesOf"]>>[number]

/** The agent's attached accounts: two Zalo OAs (the second its default), a bank feed, a sandbox Zalo OA and a Zalo OA that is not working. */
const ATTACHED = [
    { agentId: "agent-1", connectionId: "11111111-1111-4111-8111-111111111111", provider: "zalo_oa" },
    { agentId: "agent-1", connectionId: "22222222-2222-4222-8222-222222222222", provider: "zalo_oa", isDefault: true },
    { agentId: "agent-1", connectionId: "33333333-3333-4333-8333-333333333333", provider: "sepay" },
    { agentId: "agent-1", connectionId: "44444444-4444-4444-8444-444444444444", provider: "zalo_oa" },
    { agentId: "agent-1", connectionId: "55555555-5555-4555-8555-555555555555", provider: "zalo_oa" },
]
const [ZALO_1, ZALO_2, BANK, ZALO_SANDBOX, ZALO_DOWN] = ATTACHED.map((row) => row.connectionId) as [string, string, string, string, string]
const UNATTACHED = "66666666-6666-4666-8666-666666666666"

/** The connection records the read gives each attached account. */
const RECORDS = ATTACHED.map((row) => mock<ConnectionRecord>({
    id: row.connectionId,
    provider: row.provider as ConnectionRecord["provider"],
    name: `OA ${row.connectionId.slice(0, 1)}`,
    meta: {},
    status: row.connectionId === ZALO_DOWN ? "error" : "connected",
    sandbox: row.connectionId === ZALO_SANDBOX,
}))

const build = async (role: Role | null = "owner", options: { readonly sandboxOn?: boolean } = {}) => {
    const seats = mock<WorkspaceMemberSeatsService>()
    seats.activeSeatOfUser.mockResolvedValue(
        role === null ? null : mock<MemberSeatRecord>({ memberId: "member-1", role }),
    )
    const installations = mock<InstallationRecordsService>()
    installations.find.mockResolvedValue(mock<InstallationRecord>({ agentId: "agent-1", moduleKey: "booking" }))
    const workflows = mock<AgentWorkflowsService>()
    workflows.detail.mockResolvedValue(DETAIL)
    workflows.list.mockResolvedValue([VIEW])
    workflows.publish.mockResolvedValue(VERSION)
    workflows.createFromTemplate.mockResolvedValue(VIEW)
    const runs = mock<AgentWorkflowRunsService>()
    const attachments = mock<AccountAttachmentsService>()
    attachments.listOfAgent.mockResolvedValue(ATTACHED)
    const bindings = mock<ConnectionBindingsReadService>()
    bindings.recordOf.mockImplementation((_workspaceId: string, id: string) =>
        Promise.resolve((RECORDS.find((record) => record.id === id) ?? null) as ConnectionRecord | null),
    )
    const sandbox = mock<ProviderSandboxService>()
    sandbox.enabled.mockReturnValue(options.sandboxOn ?? false)
    const agents = mock<AgentDirectoryService>()
    agents.identitiesOf.mockResolvedValue([])
    const moduleRef = await Test.createTestingModule({
        providers: [
            AgentWorkflowsAdminService,
            { provide: WorkspaceMemberSeatsService, useValue: seats },
            { provide: InstallationRecordsService, useValue: installations },
            { provide: AgentWorkflowsService, useValue: workflows },
            { provide: AgentWorkflowRunsService, useValue: runs },
            { provide: AgentDirectoryService, useValue: agents },
            { provide: AccountAttachmentsService, useValue: attachments },
            { provide: ConnectionBindingsReadService, useValue: bindings },
            { provide: ProviderSandboxService, useValue: sandbox },
        ],
    }).compile()
    return { admin: moduleRef.get(AgentWorkflowsAdminService), workflows, installations, runs, agents, attachments }
}

describe("AgentWorkflowsAdminService: seats", () => {
    it("lists the workflows of the installation's agent for a manager, as wires", async () => {
        const { admin, workflows } = await build("manager")

        const listed = await admin.list(ACTOR, { installationId: "inst-1", locale: "en" })

        expect(workflows.list).toHaveBeenCalledWith("ws-1", "agent-1", "en")
        expect(listed).toEqual([expect.objectContaining({ id: "wf-1", templateId: null, templateVersion: null })])
    })

    it("refuses staff and an account with no seat", async () => {
        const staff = await build("staff")
        const none = await build(null)

        await expect(staff.admin.list(ACTOR, { installationId: "inst-1" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.Forbidden,
        })
        await expect(none.admin.templates(ACTOR, {})).rejects.toMatchObject({ code: AgentGraphsErrorCode.Forbidden })
    })

    it("refuses a workflow of another agent, and an installation with no agent", async () => {
        const { admin, workflows, installations } = await build()
        workflows.detail.mockResolvedValue({ ...DETAIL, workflow: { ...VIEW, agentId: "agent-9" } })

        await expect(admin.detail(ACTOR, { installationId: "inst-1", workflowId: "wf-1" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.WorkflowNotFound,
        })
        installations.find.mockResolvedValue(null)
        await expect(admin.list(ACTOR, { installationId: "inst-x" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.GraphNotFound,
        })
    })

    it("lets staff read the templates and the run pins", async () => {
        const { admin, runs } = await build("staff")
        runs.pinsOf.mockResolvedValue([])

        // Booking ships two templates: book and remind. Ledger (TOOLS-LEAD F2): the third, `booking.team-chat`, left with BIZ-MOVE-LEAD's
        // booking agent (like content, it has no team-chat graph: the router only reaches a module that ships `<module>.team-chat`).
        await expect(admin.templates(ACTOR, { moduleKey: "booking" })).resolves.toHaveLength(2)
        await expect(admin.template(ACTOR, { templateId: "sales.consult" })).resolves.toMatchObject({ primary: true })
        await expect(admin.runPins(ACTOR, { installationId: "inst-1", runIds: ["run-1"] })).resolves.toEqual([])
    })
})

describe("AgentWorkflowsAdminService: graph", () => {
    const CALL = {
        nodeKey: "hand",
        outcome: "done",
        agent: "sales",
        agentLabel: "Sales",
        workflow: "quote",
        workflowName: "Quote",
        version: "latest",
        crossAgent: true,
    }
    const OWN = { ...CALL, nodeKey: "own", agent: "booking", agentLabel: "Accounting", crossAgent: false }
    const ENTRY = {
        id: "wf-1",
        key: "reports",
        name: "Reports",
        status: "active" as const,
        primary: true,
        activeNumber: 1,
        entry: "any" as const,
        entryLabel: "Anyone",
        inputs: [],
        triggers: [],
        outcomes: [],
        calls: [CALL, OWN],
    }
    const GRAPH_PAGE: AgentWorkflowGraph = { agentId: "agent-1", workflows: [ENTRY] }

    it("names the installed agent and the agent of each cross-agent target, for a manager", async () => {
        const { admin, workflows, installations, agents } = await build("manager")
        installations.find.mockResolvedValue(
            mock<InstallationRecord>({ agentId: "agent-1", moduleKey: "booking", name: "Accounting Ann" }),
        )
        installations.firstOfModule.mockResolvedValue(
            mock<InstallationRecord>({ name: "Sales Ben", agentId: "agent-2" }),
        )
        agents.identitiesOf.mockResolvedValue([
            mock<AgentIdentityCard>({ id: "agent-1", avatarUrl: null }),
            mock<AgentIdentityCard>({ id: "agent-2", avatarUrl: "https://cdn.example.org/ben.png" }),
        ])
        workflows.graphOf.mockResolvedValue(GRAPH_PAGE)

        const page = await admin.graph(ACTOR, { installationId: "inst-1", locale: "en" })

        expect(workflows.graphOf).toHaveBeenCalledWith("ws-1", "agent-1", "en")
        expect(installations.firstOfModule).toHaveBeenCalledTimes(1)
        expect(installations.firstOfModule).toHaveBeenCalledWith("ws-1", "sales")
        expect(page.agentLabel).toBe("Accounting Ann")
        expect(page.agentAvatar).toBeNull()
        expect(page.workflows[0]?.calls).toEqual([
            { ...CALL, agentLabel: "Sales Ben", agentAvatar: "https://cdn.example.org/ben.png" },
            { ...OWN, agentAvatar: null },
        ])
    })

    it("keeps the domain's label when the target module is not installed, refuses staff and an unknown installation", async () => {
        const { admin, workflows, installations } = await build("owner")
        installations.firstOfModule.mockResolvedValue(null)
        workflows.graphOf.mockResolvedValue(GRAPH_PAGE)

        const page = await admin.graph(ACTOR, { installationId: "inst-1" })

        expect(page.workflows[0]?.calls[0]?.agentLabel).toBe("Sales")
        const staff = await build("staff")
        await expect(staff.admin.graph(ACTOR, { installationId: "inst-1" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.Forbidden,
        })
        installations.find.mockResolvedValue(null)
        await expect(admin.graph(ACTOR, { installationId: "inst-x" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.GraphNotFound,
        })
    })
})

describe("AgentWorkflowsAdminService: changes", () => {
    it("keeps a widening the owner's alone on every road that writes a version: a rollback and a template sync", async () => {
        const manager = await build("manager")
        const changing = { installationId: "inst-1", workflowId: "wf-1", note: "", expectedLatest: 1 }
        manager.workflows.versionDiff.mockResolvedValue({ before: null, after: WIDER, diff: NO_DIFF })
        manager.workflows.templatePreview.mockResolvedValue(previewOf(GRAPH, WIDER))

        await expect(manager.admin.rollback(ACTOR, { ...changing, number: 1 })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.WidensNeedsOwner,
        })
        await expect(manager.admin.acceptTemplate(ACTOR, { ...changing, templateVersion: 2 })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.WidensNeedsOwner,
        })
        expect(manager.workflows.rollback).not.toHaveBeenCalled()
        expect(manager.workflows.acceptTemplate).not.toHaveBeenCalled()
    })

    it("has no door that publishes a graph the caller sends, and none that saves a layout (a stored graph is exactly a template version)", () => {
        const doors = Object.getOwnPropertyNames(AgentWorkflowsAdminService.prototype)

        expect(doors).not.toEqual(expect.arrayContaining(["publish"]))
        expect(doors.filter((name) => ["publish", "saveLayout", "layout", "setNodeMode"].includes(name))).toEqual([])
    })

})

describe("AgentWorkflowsAdminService: adding and mapping", () => {
    it("adds a workflow from a template (a workflow is always a template's copy: no blank workflow)", async () => {
        const { admin, workflows } = await build()

        await admin.create(ACTOR, { installationId: "inst-1", templateId: "booking.remind" })

        expect(workflows.createFromTemplate).toHaveBeenCalledWith(
            "ws-1",
            "agent-1",
            { templateId: "booking.remind", version: null },
            expect.objectContaining({ memberId: "member-1" }),
            "vi",
        )
        expect(Object.getOwnPropertyNames(AgentWorkflowsService.prototype)).not.toContain("createBlank")
    })

    it("maps a status and a diff request onto the service", async () => {
        const { admin, workflows } = await build()
        workflows.versionDiff.mockResolvedValue({
            before: null,
            after: GRAPH,
            diff: {
                steps: [],
                triggerChanged: false,
                grant: {
                    toolsAdded: [],
                    toolsRemoved: [],
                    effectsAdded: [],
                    effectsRemoved: [],
                },
            },
        })

        await expect(
            admin.setStatus(ACTOR, { installationId: "inst-1", workflowId: "wf-1", status: "active" }),
        ).resolves.toBe(true)
        const diff = await admin.diff(ACTOR, {
            installationId: "inst-1",
            workflowId: "wf-1",
            number: 1,
            against: "previous",
        })

        expect(workflows.setStatus).toHaveBeenCalledWith("ws-1", "wf-1", "active")
        expect(workflows.versionDiff).toHaveBeenCalledWith("ws-1", "wf-1", 1, { kind: "previous" })
        expect(diff).toMatchObject({ beforeJson: null, afterJson: JSON.stringify(GRAPH) })
    })
})

describe("AgentWorkflowsAdminService.agreeRights: the owner's picks of a stream's one source (nothing else is agreed)", () => {
    const PICK = {
        workflowId: "wf-1",
        verb: "nivo.trigger.payment.credit.received",
        stream: "bank-account:VCB:111",
        connectionId: "c1",
    }

    it("takes no rights entries: it checks the owner's picks, records the checked ones, and answers that nothing was agreed", async () => {
        const { admin, runs } = await build("owner")
        runs.triggerPicksOf.mockResolvedValue([PICK])

        const answer = await admin.agreeRights(ACTOR, { installationId: "inst-1", triggerPicks: [PICK] })

        expect(answer).toEqual({ nodeRightsDecide: true, agreed: 0 })
        expect(runs.triggerPicksOf).toHaveBeenCalledWith("ws-1", "agent-1", [PICK])
        expect(runs.recordTriggerPicks).toHaveBeenCalledWith("ws-1", "agent-1", "member-1", [PICK])
    })

    it("refuses a manager's pick, writing nothing: only the owner picks a source", async () => {
        const { admin, runs } = await build("manager")

        await expect(admin.agreeRights(ACTOR, { installationId: "inst-1", triggerPicks: [PICK] })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.Forbidden,
        })
        expect(runs.recordTriggerPicks).not.toHaveBeenCalled()
    })

    it("refuses staff and an account with no seat, whatever the request names", async () => {
        const staff = await build("staff")
        const none = await build(null)

        await expect(staff.admin.agreeRights(ACTOR, { installationId: "inst-1" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.Forbidden,
        })
        await expect(none.admin.agreeRights(ACTOR, { installationId: "inst-1" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.Forbidden,
        })
    })
})

// THE ONE DOOR of a node's settings (`node-settings.policy`): the owner sets a node step's mode and / or which of the agent's attached
// accounts it uses, in try order. Each setting is judged by rule (the step takes it; the accounts are attached, working, of a provider
// the step lists, sandbox only while the sandbox is on, named once); the change is a NEW version through the judged publish road.
describe("AgentWorkflowsAdminService.setNodeSettings: the owner sets a node step's mode and accounts", () => {
    const REPLYING: GraphSpec = {
        ...GRAPH,
        nodes: [
            {
                key: "reply",
                kind: "execute",
                step: "chatbot.answer",
                mode: "auto",
                accounts: [
                    { kind: "messaging", provider: "zalo_oa", connectionId: null },
                    { kind: "messaging", provider: "telegram", connectionId: null },
                ],
                next: "hand",
            },
            { key: "hand", kind: "execute", step: "core.call-workflow", next: "end" },
            { key: "end", kind: "output", step: "stop" },
        ],
    }
    const [REPLY, HAND, END] = REPLYING.nodes as [GraphSpec["nodes"][number], GraphSpec["nodes"][number], GraphSpec["nodes"][number]]
    const setting = { installationId: "inst-1", workflowId: "wf-1", nodeKey: "reply", expectedLatest: 1 }
    const replying = async (role: Role = "owner", options: { readonly sandboxOn?: boolean } = {}) => {
        const seat = await build(role, options)
        seat.workflows.detail.mockResolvedValue({ ...DETAIL, graph: REPLYING })
        return seat
    }

    it("writes a NEW version with only that node's mode replaced, through the publish road, as the owner", async () => {
        const owner = await replying()

        await expect(owner.admin.setNodeSettings(ACTOR, { ...setting, mode: "ask" })).resolves.toMatchObject({ id: "wfv-2" })

        expect(owner.workflows.publish).toHaveBeenCalledWith(
            "ws-1",
            "wf-1",
            { ...REPLYING, nodes: [{ ...REPLY, mode: "ask" }, HAND, END] },
            { kind: "owner", memberId: "member-1", role: "owner" },
            1,
            "reply: ask",
        )
    })

    it("binds the chosen accounts on the step's entries in try order (one entry per chosen account), the other providers left to the default pick", async () => {
        const owner = await replying()

        await owner.admin.setNodeSettings(ACTOR, { ...setting, accountIds: [ZALO_2, ZALO_1] })

        expect(owner.workflows.publish).toHaveBeenCalledWith(
            "ws-1",
            "wf-1",
            {
                ...REPLYING,
                nodes: [
                    {
                        ...REPLY,
                        accounts: [
                            { kind: "messaging", provider: "zalo_oa", connectionId: ZALO_2 },
                            { kind: "messaging", provider: "zalo_oa", connectionId: ZALO_1 },
                            { kind: "messaging", provider: "telegram", connectionId: null },
                        ],
                    },
                    HAND,
                    END,
                ],
            },
            expect.anything(),
            1,
            `reply: accounts ${ZALO_2},${ZALO_1}`,
        )
    })

    it("an empty choice goes back to the default pick: the entries as the template states them", async () => {
        const owner = await replying()
        const chosen: GraphSpec = {
            ...REPLYING,
            nodes: [
                {
                    ...REPLY,
                    accounts: [
                        { kind: "messaging", provider: "zalo_oa", connectionId: ZALO_2 },
                        { kind: "messaging", provider: "telegram", connectionId: null },
                    ],
                },
                HAND,
                END,
            ],
        }
        owner.workflows.detail.mockResolvedValue({ ...DETAIL, graph: chosen })

        await owner.admin.setNodeSettings(ACTOR, { ...setting, accountIds: [] })

        expect(owner.workflows.publish).toHaveBeenCalledWith("ws-1", "wf-1", REPLYING, expect.anything(), 1, "reply: accounts default")
    })

    it("writes nothing for settings already in force and answers the running version", async () => {
        const owner = await replying()

        await expect(owner.admin.setNodeSettings(ACTOR, { ...setting, mode: "auto", accountIds: [] })).resolves.toMatchObject({
            id: "wfv-2",
            number: 2,
        })
        expect(owner.workflows.publish).not.toHaveBeenCalled()
    })

    it.each([
        ["an account the agent is not attached to", [UNATTACHED], AgentGraphsErrorCode.NodeAccountNotAttached],
        ["an account of a provider the step does not list (a bank feed on a reply step)", [BANK], AgentGraphsErrorCode.NodeAccountNotListed],
        ["an account that is not working", [ZALO_DOWN], AgentGraphsErrorCode.NodeAccountNotConnected],
        ["a sandbox account while the sandbox is off", [ZALO_SANDBOX], AgentGraphsErrorCode.NodeAccountSandboxOff],
        ["one account named twice", [ZALO_1, ZALO_1], AgentGraphsErrorCode.NodeAccountRepeated],
    ])("refuses, typed, %s, and writes nothing", async (_name, accountIds, code) => {
        const owner = await replying()

        await expect(owner.admin.setNodeSettings(ACTOR, { ...setting, accountIds })).rejects.toMatchObject({ code })
        expect(owner.workflows.publish).not.toHaveBeenCalled()
    })

    it("takes a sandbox account while the sandbox is on", async () => {
        const owner = await replying("owner", { sandboxOn: true })

        await owner.admin.setNodeSettings(ACTOR, { ...setting, accountIds: [ZALO_SANDBOX] })

        expect(owner.workflows.publish).toHaveBeenCalledTimes(1)
    })

    it("refuses, typed, a setting the step does not take: a mode or accounts on an engine control step", async () => {
        const owner = await replying()

        await expect(owner.admin.setNodeSettings(ACTOR, { ...setting, nodeKey: "hand", mode: "ask" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.NodeSettingUnsettable,
            params: { setting: "mode" },
        })
        await expect(owner.admin.setNodeSettings(ACTOR, { ...setting, nodeKey: "hand", accountIds: [] })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.NodeSettingUnsettable,
            params: { setting: "accounts" },
        })
        expect(owner.workflows.publish).not.toHaveBeenCalled()
    })

    it("is the owner's alone: a manager and staff are refused before anything is read or written", async () => {
        for (const role of ["manager", "staff"] as const) {
            const seat = await replying(role)
            await expect(seat.admin.setNodeSettings(ACTOR, { ...setting, mode: "ask" })).rejects.toMatchObject({
                code: AgentGraphsErrorCode.Forbidden,
            })
            expect(seat.workflows.detail).not.toHaveBeenCalled()
            expect(seat.workflows.publish).not.toHaveBeenCalled()
        }
    })

    it("refuses, typed, a word that is no mode, a key no node has, and a workflow of another agent", async () => {
        const owner = await replying()

        await expect(owner.admin.setNodeSettings(ACTOR, { ...setting, mode: "never" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.WorkflowRefused,
            params: { reason: "mode" },
        })
        await expect(owner.admin.setNodeSettings(ACTOR, { ...setting, nodeKey: "gone", mode: "ask" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.WorkflowRefused,
            params: { reason: "node" },
        })
        owner.workflows.detail.mockResolvedValue({ ...DETAIL, workflow: { ...VIEW, agentId: "agent-2" } })
        await expect(owner.admin.setNodeSettings(ACTOR, { ...setting, mode: "ask" })).rejects.toMatchObject({
            code: AgentGraphsErrorCode.WorkflowNotFound,
        })
        expect(owner.workflows.publish).not.toHaveBeenCalled()
    })
})

describe("AgentWorkflowsAdminService.detail: every step's node settings, for the fe to draw without guessing", () => {
    it("answers per step what is settable, what is in force and the attached accounts it could use (default and sandbox marked)", async () => {
        const owner = await build("manager")
        owner.workflows.detail.mockResolvedValue({
            ...DETAIL,
            graph: {
                ...GRAPH,
                nodes: [
                    {
                        key: "reply",
                        kind: "execute",
                        step: "chatbot.answer",
                        mode: "ask",
                        accounts: [{ kind: "messaging", provider: "zalo_oa", connectionId: ZALO_2 }],
                        next: "hand",
                    },
                    { key: "hand", kind: "execute", step: "core.call-workflow", next: "end" },
                    { key: "end", kind: "output", step: "stop" },
                ],
            },
        })

        const read = await owner.admin.detail(ACTOR, { installationId: "inst-1", workflowId: "wf-1" })

        expect(read.nodeSettings).toEqual([
            {
                nodeKey: "reply",
                settable: ["mode", "accounts"],
                mode: "ask",
                accountIds: [ZALO_2],
                accounts: [ZALO_1, ZALO_2, ZALO_SANDBOX, ZALO_DOWN].map((connectionId) =>
                    expect.objectContaining({
                        connectionId,
                        provider: "zalo_oa",
                        isDefault: connectionId === ZALO_2,
                        sandbox: connectionId === ZALO_SANDBOX,
                        connected: connectionId !== ZALO_DOWN,
                    }),
                ),
            },
            { nodeKey: "hand", settable: [], mode: null, accountIds: [], accounts: [] },
            { nodeKey: "end", settable: [], mode: null, accountIds: [], accounts: [] },
        ])
    })
})
