import { Test } from "@nestjs/testing"
import { mock, mockEntityManager } from "@starci/jest-preset"
import type { MockEntityManager } from "@starci/jest-preset"
import { AgentDirectoryService } from "@modules/domain/agents"
import { AgentRunsService } from "@modules/domain/agent-runs"
import { ToolCallLogService } from "@modules/domain/tool-call-log"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import { ConnectionEntity } from "@modules/domain/connections/persistence/entities"
import type { ConnectionStatusFacts } from "@modules/domain/connections"
import { AccountAttachmentsService, toolGrantsEntities } from "@modules/domain/tool-grants"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { LOGGER, type Logger } from "@modules/platform/logging"
import { NODE_REQUESTS_GATE } from "./node-requests.decorators"
import type { NodeRequestsGate, OptionalNodeRequest } from "./node-mode.policy"
import { AgentAccountsService } from "./agent-accounts.service"
import type { RightSeen } from "./right-origin.contracts"

/** The entities of the attachment store, as their owning capability registers them. */
const [, AccountAttachmentEntity] = toolGrantsEntities
type AttachmentRow = InstanceType<typeof AccountAttachmentEntity>

const WS = "ws-1"
const SALES = "agent-sales"

/** One connection of the shop: its id, provider and status. */
type Account = readonly [id: string, provider: string, status: string]

/** The dev shop: one Zalo OA, one SePay account and one Google account work; Telegram and payOS are still pending. */
const ONE_EACH: ReadonlyArray<Account> = [
    ["oa-1", "zalo_oa", "connected"],
    ["mb", "sepay", "connected"],
    ["sheet", "google", "connected"],
    ["tg", "telegram", "pending"],
    ["pay", "payos", "pending"],
]

/** A shop with two Zalo OAs and two SePay accounts. */
const TWO_EACH: ReadonlyArray<Account> = [
    ["oa-1", "zalo_oa", "connected"],
    ["oa-2", "zalo_oa", "connected"],
    ["mb", "sepay", "connected"],
    ["vcb", "sepay", "connected"],
]

const rowOf = (agentId: string, connectionId: string, provider: string): AttachmentRow =>
    Object.assign(new AccountAttachmentEntity(), {
        id: `${agentId}:${connectionId}`,
        workspaceId: WS,
        agentId,
        connectionId,
        provider,
        updatedBy: "owner-1",
        isDefault: false,
    })

/** What a spec binds of the run's own records: the stored run (its trigger context) and the tool call log. */
interface RunReaders {
    /** The runs reader. */
    readonly runs?: AgentRunsService
    /** The call log. */
    readonly callLog?: ToolCallLogService
    /** The connections that are SANDBOX accounts (lane concept provider-sandbox); every other one is live. */
    readonly sandbox?: ReadonlyArray<string>
    /** The logger, when a spec reads what the service reported. */
    readonly logger?: Logger
}

/**
 * The service over the real attachment store: the shop's `accounts`, the stored `rows`, and what the step's node declares (`request`: its
 * mode and providers, or null when it states none).
 */
const build = async (
    accounts: ReadonlyArray<Account> = ONE_EACH,
    rows: ReadonlyArray<AttachmentRow> = [],
    request: OptionalNodeRequest = null,
    run: RunReaders = {},
) => {
    // Every account of this world is connected: the attachment read keeps only attachments to a live connection (R36).
    const live = [...new Set(rows.map((row) => row.connectionId))].map((id) => Object.assign(new ConnectionEntity(), { id }))
    const entityManager: MockEntityManager = mockEntityManager({
        find: [
            [AccountAttachmentEntity, [...rows]],
            [ConnectionEntity, live],
        ],
        insert: [AccountAttachmentEntity, {}],
    })
    const agents = mock<AgentDirectoryService>()
    agents.cardsOf.mockImplementation((_workspaceId, ids) =>
        Promise.resolve(ids.map((id) => ({ id, name: id, module: "sales" }))),
    )
    // The directory answers the ACTIVE agents only: "agent-removed" (a removed Sales copy) is not among them.
    agents.activeOf.mockResolvedValue(
        [
            ["agent-chatbot", "chatbot"],
            [SALES, "sales"],
            ["agent-hr", "hiring"],
        ].map(([id = "", module = ""]) => ({ id, name: id, module })),
    )
    const connections = mock<ConnectionBindingsReadService>()
    connections.ofProvider.mockImplementation((_workspaceId, provider) =>
        Promise.resolve(
            accounts
                .filter((account) => account[1] === provider)
                .map(([id, , status]) => mock<ConnectionStatusFacts>({ id, name: `${id} account`, status, accountMasked: null })),
        ),
    )
    connections.recordOf.mockResolvedValue(null)
    connections.factsOf.mockImplementation((ids) =>
        Promise.resolve(
            ids.map((id) => ({ id, provider: "", name: id, status: "connected", createdAt: new Date(0), sandbox: (run.sandbox ?? []).includes(id), botUsername: null, accountMasked: null })),
        ),
    )
    const gate = mock<NodeRequestsGate>()
    gate.requestOf.mockResolvedValue(request)
    const moduleRef = await Test.createTestingModule({
        providers: [
            AgentAccountsService,
            AccountAttachmentsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: AgentDirectoryService, useValue: agents },
            { provide: ConnectionBindingsReadService, useValue: connections },
            { provide: NODE_REQUESTS_GATE, useValue: gate },
            ...(run.runs === undefined ? [] : [{ provide: AgentRunsService, useValue: run.runs }]),
            ...(run.callLog === undefined ? [] : [{ provide: ToolCallLogService, useValue: run.callLog }]),
            ...(run.logger === undefined ? [] : [{ provide: LOGGER, useValue: run.logger }]),
        ],
    }).compile()
    return { service: moduleRef.get(AgentAccountsService), entityManager, gate }
}

const TARGET = { workspaceId: WS, agentId: SALES, moduleKey: "sales" }
const SEND = "nivo.tool.customer.message.send"
const QR_TOOL = "nivo.tool.payment.request.create"
const BANK_TOOL = "nivo.tool.bank.transaction.list"
const STEP = { nodeKey: "reply", versionId: "v-3", workflowId: "wf-1" }

/** A node of the given mode acting through Zalo OA. */
const zaloNodeOf = (mode: "auto" | "ask"): OptionalNodeRequest => ({
    mode,
    accounts: [{ kind: "messaging", provider: "zalo_oa", connectionId: null }],
})

/** A node of the given mode acting through SePay. */
const bankNodeOf = (mode: "auto" | "ask"): OptionalNodeRequest => ({
    mode,
    accounts: [{ kind: "payment", provider: "sepay", connectionId: null }],
})

/** Where a node's call came from, as the door and the executors state it. */
const FROM_NODE: RightSeen = { origin: "node", node: STEP }

describe("AgentAccountsService.attachmentOf: the kill switch is the attachment to the very account", () => {
    it("two Zalo OAs: a send reaches the OA the agent is attached to, and is not_attached on the other one", async () => {
        const { service } = await build(TWO_EACH, [rowOf(SALES, "oa-1", "zalo_oa")])

        await expect(service.attachmentOf(WS, SALES, SEND, { provider: "zalo_oa", connectionId: "oa-1" })).resolves.toEqual({
            kind: "allow",
            provider: "zalo_oa",
            connectionId: "oa-1",
        })
        await expect(service.attachmentOf(WS, SALES, SEND, { provider: "zalo_oa", connectionId: "oa-2" })).resolves.toEqual({
            kind: "refuse",
            reason: "not_attached",
            providers: ["zalo_oa"],
            connectionId: "oa-2",
        })
    })

    it("any serving attachment counts when the call names no account; none is not_attached; a tool no provider serves is not judged", async () => {
        const attached = await build(ONE_EACH, [rowOf(SALES, "mb", "sepay")])
        await expect(attached.service.attachmentOf(WS, SALES, BANK_TOOL)).resolves.toMatchObject({ kind: "allow", connectionId: "mb" })

        const none = await build(ONE_EACH, [])
        await expect(none.service.attachmentOf(WS, SALES, BANK_TOOL)).resolves.toMatchObject({ kind: "refuse", reason: "not_attached" })
        await expect(none.service.attachmentOf(WS, SALES, "nivo.tool.brain.search")).resolves.toBeNull()
    })

    it("two SePay accounts: transactions are read on every account the agent is attached to", async () => {
        const { service } = await build(TWO_EACH, [rowOf(SALES, "mb", "sepay"), rowOf(SALES, "vcb", "sepay")])

        await expect(service.accountsOfAgent(WS, SALES, BANK_TOOL)).resolves.toEqual(["mb", "vcb"])
        await expect(service.accountsOfAgent(WS, SALES, QR_TOOL)).resolves.toEqual(["mb", "vcb"])
        await expect(service.accountsOfAgent(WS, SALES, SEND)).resolves.toEqual([])
    })
})

describe("AgentAccountsService.judgeSend: the attachment to the very account; the node's mode is the door's", () => {
    const send = (step?: typeof STEP) => ({
        workspaceId: WS,
        agentId: SALES,
        effect: SEND,
        target: { provider: "zalo_oa", connectionId: "oa-1" },
        ...(step === undefined ? {} : { step }),
    })

    it("an attached agent's send is allowed whatever its node declares, and the node is never read (the tool door asks the mode)", async () => {
        const auto = await build(TWO_EACH, [rowOf(SALES, "oa-1", "zalo_oa")], zaloNodeOf("auto"))
        await expect(auto.service.judgeSend(send(STEP))).resolves.toEqual({ kind: "allow", provider: "zalo_oa", connectionId: "oa-1" })
        expect(auto.gate.requestOf).not.toHaveBeenCalled()

        const ask = await build(TWO_EACH, [rowOf(SALES, "oa-1", "zalo_oa")], zaloNodeOf("ask"))
        await expect(ask.service.judgeSend(send(STEP))).resolves.toEqual({ kind: "allow", provider: "zalo_oa", connectionId: "oa-1" })
        expect(ask.gate.requestOf).not.toHaveBeenCalled()
    })

    it("a detached agent is not_attached on that account, with or without a step", async () => {
        const detached = await build(TWO_EACH, [], zaloNodeOf("auto"))
        await expect(detached.service.judgeSend(send(STEP))).resolves.toMatchObject({ kind: "refuse", reason: "not_attached" })
        await expect(detached.service.judgeSend(send())).resolves.toMatchObject({ kind: "refuse", reason: "not_attached" })
        expect(detached.gate.requestOf).not.toHaveBeenCalled()
    })

    it("the engine's own line runs once attached, even under an ask node; detached it is refused", async () => {
        const ask = await build(TWO_EACH, [rowOf(SALES, "oa-1", "zalo_oa")], zaloNodeOf("ask"))
        await expect(ask.service.judgeEngineLine(send(STEP))).resolves.toEqual({ kind: "allow", provider: "zalo_oa", connectionId: "oa-1" })

        const detached = await build(TWO_EACH, [], zaloNodeOf("ask"))
        await expect(detached.service.judgeEngineLine(send(STEP))).resolves.toMatchObject({ kind: "refuse", reason: "not_attached" })
    })
})

describe("AgentAccountsService defaults: attach the template's providers' working accounts", () => {
    it("attaches a fresh agent to every working account of a provider its template lists, and to none that is not connected", async () => {
        const { service, entityManager } = await build()

        await expect(service.attachDefaults(TARGET, null, null)).resolves.toEqual({
            ok: true,
            attached: [
                { connectionId: "oa-1", provider: "zalo_oa" },
                { connectionId: "mb", provider: "sepay" },
            ],
        })
        expect(entityManager.insert).toHaveBeenCalledWith(AccountAttachmentEntity, [
            { workspaceId: WS, agentId: SALES, connectionId: "oa-1", provider: "zalo_oa", updatedBy: null },
            { workspaceId: WS, agentId: SALES, connectionId: "mb", provider: "sepay", updatedBy: null },
        ])
    })

    it("never touches an attachment the shop holds, and fills only the accounts the agent is not attached to", async () => {
        const held = await build(ONE_EACH, [rowOf(SALES, "oa-1", "zalo_oa"), rowOf(SALES, "mb", "sepay")])
        await expect(held.service.attachDefaults(TARGET, null, null)).resolves.toEqual({ ok: true, attached: [] })
        expect(held.entityManager.insert).not.toHaveBeenCalled()
        expect(held.entityManager.update).not.toHaveBeenCalled()
        expect(held.entityManager.delete).not.toHaveBeenCalled()

        const partly = await build(TWO_EACH, [rowOf(SALES, "oa-1", "zalo_oa")])
        const made = await partly.service.attachDefaults(TARGET, null, null)
        expect(made.ok && made.attached.map((entry) => entry.connectionId)).toEqual(["oa-2", "mb", "vcb"])
    })

    it("takes the owner's edit of the proposal, keyed by account, and writes nothing when one entry cannot be stored", async () => {
        const { service, entityManager } = await build()

        await expect(service.attachDefaults(TARGET, [{ connectionId: "oa-1" }], "owner-1")).resolves.toEqual({
            ok: true,
            attached: [{ connectionId: "oa-1", provider: "zalo_oa" }],
        })

        entityManager.insert.mockClear()
        await expect(service.wishProblem(WS, [{ connectionId: "tg" }])).resolves.toBe("not_connected")
        await expect(service.wishProblem(WS, [{ connectionId: "nowhere" }])).resolves.toBe("unknown_account")
        await expect(service.attachDefaults(TARGET, [{ connectionId: "oa-1" }, { connectionId: "tg" }], "owner-1")).resolves.toEqual({
            ok: false,
            reason: "not_connected",
        })
        expect(entityManager.insert).not.toHaveBeenCalled()
    })
})

describe("AgentAccountsService board and templates", () => {
    it("shows each provider once with the tools it serves, the shop's accounts of it, and every attachment", async () => {
        const { service } = await build(TWO_EACH, [rowOf(SALES, "vcb", "sepay")])

        const board = await service.board(WS)

        const sepay = board.providers.find((entry) => entry.provider === "sepay")
        expect(sepay?.abilities.map((ability) => ability.id)).toEqual(["transactions.read", "request.create", "request.read", "request.cancel"])
        expect(sepay?.accounts).toEqual([
            { connectionId: "mb", provider: "sepay", label: "mb account", connected: true },
            { connectionId: "vcb", provider: "sepay", label: "vcb account", connected: true },
        ])
        expect(board.providers.find((entry) => entry.provider === "meta")).toMatchObject({ connected: false, accounts: [] })
        expect(board.attachments).toEqual([{ agentId: SALES, connectionId: "vcb", provider: "sepay" }])
    })

    it("proposes one line per working account of a listed provider, and a bare line for one that is not connected", async () => {
        const { service } = await build([...TWO_EACH, ["tg", "telegram", "pending"]])

        await expect(service.templateProposal(WS, "sales")).resolves.toEqual([
            { provider: "zalo_oa", connectionId: "oa-1", accountLabel: "oa-1 account", connected: true },
            { provider: "zalo_oa", connectionId: "oa-2", accountLabel: "oa-2 account", connected: true },
            { provider: "telegram", connectionId: null, accountLabel: null, connected: false },
            { provider: "meta", connectionId: null, accountLabel: null, connected: false },
            { provider: "sepay", connectionId: "mb", accountLabel: "mb account", connected: true },
            { provider: "sepay", connectionId: "vcb", accountLabel: "vcb account", connected: true },
            { provider: "casso", connectionId: null, accountLabel: null, connected: false },
            { provider: "payos", connectionId: null, accountLabel: null, connected: false },
        ])
    })

    it("lists, for an account connected later, the active agents its template names that are not attached to THAT account", async () => {
        const { service, entityManager } = await build(TWO_EACH, [rowOf("agent-chatbot", "oa-1", "zalo_oa"), rowOf(SALES, "oa-1", "zalo_oa")])

        await expect(service.templateCandidates(WS, "oa-1")).resolves.toEqual([])
        await expect(service.templateCandidates(WS, "oa-2")).resolves.toEqual([
            { agentId: "agent-chatbot", agentName: "agent-chatbot", module: "chatbot" },
            { agentId: SALES, agentName: SALES, module: "sales" },
        ])
        await expect(service.attachByTemplate(WS, "oa-2", [SALES, "agent-hr", "agent-removed"], "owner-1")).resolves.toEqual([SALES])
        expect(entityManager.insert).toHaveBeenCalledWith(AccountAttachmentEntity, [
            { workspaceId: WS, connectionId: "oa-2", provider: "zalo_oa", agentId: SALES, updatedBy: "owner-1" },
        ])
        await expect(service.attachByTemplate(WS, "nowhere", [SALES], "owner-1")).resolves.toEqual({ ok: false, reason: "unknown_account" })
    })
})

describe("AgentAccountsService: attach and detach", () => {
    it("attaches once (a second attach is already_attached) and detach is the kill switch (not_attached once gone)", async () => {
        const fresh = await build(ONE_EACH, [])
        fresh.entityManager.findOne.mockResolvedValue(null)
        await expect(fresh.service.attach({ workspaceId: WS, agentId: SALES }, { connectionId: "mb" }, "owner-1")).resolves.toEqual({ ok: true })

        const held = await build(ONE_EACH, [rowOf(SALES, "mb", "sepay")])
        held.entityManager.findOne.mockResolvedValue(rowOf(SALES, "mb", "sepay"))
        await expect(held.service.attach({ workspaceId: WS, agentId: SALES }, { connectionId: "mb" }, "owner-1")).resolves.toEqual({
            ok: false,
            reason: "already_attached",
        })

        held.entityManager.delete.mockResolvedValue({ affected: 1, raw: [] })
        await expect(held.service.detach(WS, SALES, "mb")).resolves.toEqual({ ok: true })
        held.entityManager.delete.mockResolvedValue({ affected: 0, raw: [] })
        await expect(held.service.detach(WS, SALES, "mb")).resolves.toEqual({ ok: false, reason: "not_attached" })
    })
})

describe("AgentAccountsService: the accounts of a step are the node's providers, in its order", () => {
    const NODE_ACCOUNTS: ReadonlyArray<Account> = [["vcb", "sepay", "connected"]]
    const NODE_ROWS = [rowOf(SALES, "vcb", "sepay")]

    it("binds the agent's one attached account of each provider the node lists, and none of a provider it does not list", async () => {
        const { service } = await build(NODE_ACCOUNTS, NODE_ROWS, bankNodeOf("auto"))

        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
        await expect(service.accountsOfAgent(WS, SALES, BANK_TOOL, FROM_NODE)).resolves.toEqual(["vcb"])
        await expect(service.listsProviders(WS, SALES, BANK_TOOL, FROM_NODE)).resolves.toBe(true)

        const elsewhere = await build(NODE_ACCOUNTS, NODE_ROWS, {
            mode: "auto",
            accounts: [{ kind: "books", provider: "google", connectionId: null }],
        })
        await expect(elsewhere.service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE)).resolves.toEqual([])
        await expect(elsewhere.service.listsProviders(WS, SALES, BANK_TOOL, FROM_NODE)).resolves.toBe(false)
    })

    it("of two attached accounts of one provider binds none (it needs a pick)", async () => {
        const { service } = await build(TWO_EACH, [rowOf(SALES, "mb", "sepay"), rowOf(SALES, "vcb", "sepay")], bankNodeOf("auto"))
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE)).resolves.toEqual([])
    })

    it("binds nothing at a step whose node cannot be read, and every serving account outside a step", async () => {
        const { service } = await build(NODE_ACCOUNTS, NODE_ROWS, null)

        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE)).resolves.toEqual([])
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
    })
})

describe("AgentAccountsService: which of two accounts of one provider a step's call uses", () => {
    const rows = (defaultId: string | null) => [
        Object.assign(rowOf(SALES, "mb", "sepay"), { isDefault: defaultId === "mb" }),
        Object.assign(rowOf(SALES, "vcb", "sepay"), { isDefault: defaultId === "vcb" }),
    ]
    const RUN = { runId: "run-1" }
    const readers = (trigger: string | undefined, used: ReadonlyArray<string>) => {
        const runs = mock<AgentRunsService>()
        runs.runOf.mockResolvedValue({
            id: "run-1",
            workspaceId: WS,
            agentId: SALES,
            wakeId: "wake-1",
            trigger: "start",
            versionId: null,
            status: "running",
            context: trigger === undefined ? {} : { connectionId: trigger },
            errorCode: null,
            spoken: false,
        })
        const callLog = mock<ToolCallLogService>()
        callLog.connectionsUsedByRun.mockResolvedValue(used)
        return { runs, callLog }
    }
    const bound = (defaultId: string | null, trigger: string | undefined, used: ReadonlyArray<string>) =>
        build(TWO_EACH, rows(defaultId), bankNodeOf("auto"), readers(trigger, used))

    it("(1) binds the account the run's trigger came in on, over the run's earlier calls and the default", async () => {
        const { service } = await bound("mb", "vcb", ["mb"])
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
        await expect(service.pickNeeded(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toBeNull()
    })

    it("(2) binds an account the run already used when its trigger names none of them, over the default", async () => {
        const { service } = await bound("mb", "elsewhere", ["vcb", "mb"])
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
        const quiet = await bound("mb", undefined, ["vcb"])
        await expect(quiet.service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
    })

    it("(3) binds the agent's default account of the provider when the run names none, and hands the account without the flag", async () => {
        const { service } = await bound("vcb", undefined, [])
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
        // Without the run at all (a caller that knows none) the default still decides.
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
    })

    it("(4) binds none and names the choice when nothing picks: the provider and its candidate accounts", async () => {
        const { service } = await bound(null, undefined, [])
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([])
        await expect(service.pickNeeded(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual({
            provider: "sepay",
            connectionIds: ["mb", "vcb"],
        })
        // Outside a step there is no node to name a provider: nothing is to pick.
        await expect(service.pickNeeded(WS, SALES, BANK_TOOL)).resolves.toBeNull()
    })

    it("the single account binds when it is of the run's world; the run's world IS read (rule 19: a single-world agent is no exception)", async () => {
        const one = readers("mb", ["mb"])
        const { service } = await build(TWO_EACH, [rowOf(SALES, "vcb", "sepay")], bankNodeOf("auto"), one)

        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
        await expect(service.pickNeeded(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toBeNull()
        expect(one.runs.runOf).toHaveBeenCalled()
        // Without a run named (a caller that knows none), nothing of a run is read.
        one.runs.runOf.mockClear()
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
        expect(one.runs.runOf).not.toHaveBeenCalled()
    })

    it("makes an attachment the default through the store and refuses an account the agent is not attached to", async () => {
        const { service, entityManager } = await build(TWO_EACH, rows(null))
        const inside = mockEntityManager({ update: [AccountAttachmentEntity, { affected: 1, raw: [], generatedMaps: [] }] })
        inside.findOne.mockResolvedValueOnce(rowOf(SALES, "vcb", "sepay")).mockResolvedValueOnce(null)
        entityManager.transaction.mockImplementation((first: unknown, second?: unknown) => {
            const work = (typeof first === "function" ? first : second) as (scoped: MockEntityManager) => Promise<unknown>
            return work(inside)
        })

        await expect(service.setDefault({ workspaceId: WS, agentId: SALES }, "vcb", "owner-1")).resolves.toEqual({ ok: true })
        await expect(service.setDefault({ workspaceId: WS, agentId: SALES }, "nope", "owner-1")).resolves.toEqual({
            ok: false,
            reason: "not_attached",
        })
    })
})

describe("AgentAccountsService: ONE WORLD PER RUN (lane concept provider-sandbox rule 19): a run never mixes sandbox and live accounts", () => {
    const RUN = { runId: "run-1" }
    // The flower shop holds BOTH worlds: a sandbox Zalo OA (oa-2) the customer wrote on, a live SePay account (mb), a sandbox one (vcb).
    const readers = (trigger: string | undefined, used: ReadonlyArray<string>, sandbox: ReadonlyArray<string>) => {
        const runs = mock<AgentRunsService>()
        runs.runOf.mockResolvedValue({
            id: "run-1",
            workspaceId: WS,
            agentId: SALES,
            wakeId: "wake-1",
            trigger: "start",
            versionId: null,
            status: "running",
            context: trigger === undefined ? {} : { connectionId: trigger },
            errorCode: null,
            spoken: false,
        })
        const callLog = mock<ToolCallLogService>()
        callLog.connectionsUsedByRun.mockResolvedValue(used)
        return { runs, callLog, sandbox }
    }
    const live = Object.assign(rowOf(SALES, "mb", "sepay"), { isDefault: true })
    const sandboxBank = rowOf(SALES, "vcb", "sepay")
    const sandboxOa = rowOf(SALES, "oa-2", "zalo_oa")

    it("a run woken on a SANDBOX account binds the sandbox bank account, though the LIVE one is the agent's default", async () => {
        const { service } = await build(TWO_EACH, [live, sandboxBank, sandboxOa], bankNodeOf("auto"), readers("oa-2", [], ["oa-2", "vcb"]))
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
    })

    it("a sandbox run whose provider has only a LIVE account attached binds nothing (the kill switch refuses), never the live account", async () => {
        const { service } = await build(TWO_EACH, [live, sandboxOa], bankNodeOf("auto"), readers("oa-2", [], ["oa-2"]))
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([])
        await expect(service.pickNeeded(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toBeNull()
    })

    it("a LIVE run (woken on the live OA) never binds a sandbox account, whatever the node settings or the default say", async () => {
        const liveOa = rowOf(SALES, "oa-1", "zalo_oa")
        const sandboxDefault = Object.assign(rowOf(SALES, "vcb", "sepay"), { isDefault: true })
        const { service } = await build(TWO_EACH, [rowOf(SALES, "mb", "sepay"), sandboxDefault, liveOa], bankNodeOf("auto"), readers("oa-1", [], ["vcb"]))
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([{ provider: "sepay", connectionId: "mb" }])
    })

    it("second kind: a run of no event account (a clock round) is fixed by the account its calls already used", async () => {
        const { service } = await build(TWO_EACH, [live, sandboxBank, sandboxOa], zaloNodeOf("auto"), readers(undefined, ["vcb"], ["oa-2", "vcb"]))
        // The OA of the live world is not attached; the run's world (sandbox, from its earlier bank call) binds the sandbox OA.
        await expect(service.boundAccountsOf(WS, SALES, SEND, FROM_NODE, RUN)).resolves.toEqual([{ provider: "zalo_oa", connectionId: "oa-2" }])
        const liveRun = await build(TWO_EACH, [live, sandboxBank, sandboxOa], zaloNodeOf("auto"), readers(undefined, ["mb"], ["oa-2", "vcb"]))
        await expect(liveRun.service.boundAccountsOf(WS, SALES, SEND, FROM_NODE, RUN)).resolves.toEqual([])
    })

    it("a run that touched no account yet (a clock round) takes the world its agent's DEFAULT accounts agree on", async () => {
        // The live SePay `mb` is the agent's only default: the run is live, and the live account binds.
        const { service } = await build(TWO_EACH, [live, sandboxBank, sandboxOa], bankNodeOf("auto"), readers(undefined, [], ["oa-2", "vcb"]))
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([{ provider: "sepay", connectionId: "mb" }])
        // A sandbox default instead: the same round is sandbox, and the sandbox bank binds though the node names nothing.
        const sandboxDefault = Object.assign(rowOf(SALES, "vcb", "sepay"), { isDefault: true })
        const other = await build(TWO_EACH, [rowOf(SALES, "mb", "sepay"), sandboxDefault, sandboxOa], bankNodeOf("auto"), readers(undefined, [], ["oa-2", "vcb"]))
        await expect(other.service.boundAccountsOf(WS, SALES, BANK_TOOL, FROM_NODE, RUN)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
    })
})

/*
 * SAFE-PICK (RESTART-R9 incident, 2026-11-15): a sale called by the front desk (`workflow.called`: its stored context names NO account)
 * reached its pay step; the sales agent was attached to the shop's LIVE payOS and its SANDBOX payOS, the step's node settings listed
 * [live, sandbox] in that order; the run's world was never fixed (no trigger account, its customer sends log no account), so the node
 * setting's first entry bound the LIVE account. Rule 19 now fixes the world of a called run by its CALLER's (along the chain), narrows
 * every rung to it, and refuses typed when that world holds no account; a run with nothing fixing it takes its agent's agreeing defaults.
 */
describe("AgentAccountsService: ONE WORLD PER RUN across a chain of calls, every rung, every road (SAFE-PICK)", () => {
    const PAY_ACCOUNTS: ReadonlyArray<Account> = [
        ["pay-live", "payos", "connected"],
        ["pay-sbx", "payos", "connected"],
        ["oa-sbx", "zalo_oa", "connected"],
        ["oa-live", "zalo_oa", "connected"],
        ["vcb", "sepay", "connected"],
        ["mb", "sepay", "connected"],
    ]
    const SANDBOX = ["pay-sbx", "oa-sbx", "vcb"]
    const CALLED = { runId: "run-sale" }
    /** The pay step as the shop's standard stored it: payOS live then sandbox, then SePay with no account chosen. */
    const payNode: OptionalNodeRequest = {
        mode: "auto",
        accounts: [
            { kind: "payment", provider: "payos", connectionId: "pay-live" },
            { kind: "payment", provider: "payos", connectionId: "pay-sbx" },
            { kind: "payment", provider: "sepay", connectionId: null },
        ],
    }
    /** A stored run: its trigger account (or none) and the run that called it (or none), as the wake's plain data names it. */
    interface StoredRun {
        readonly trigger?: string
        readonly caller?: string
        readonly used?: ReadonlyArray<string>
    }
    /** The run records of a chain of calls, by run id. */
    const chain = (stored: Readonly<Record<string, StoredRun>>, logger?: Logger): RunReaders => {
        const runs = mock<AgentRunsService>()
        runs.runOf.mockImplementation((_workspaceId, runId) => {
            const run = stored[runId]
            if (run === undefined) return Promise.resolve(null)
            const context = {
                ...(run.trigger === undefined ? {} : { connectionId: run.trigger }),
                ...(run.caller === undefined ? {} : { tagContext: JSON.stringify({ workflowCall: { workflow: "consult" }, caller: { runId: run.caller } }) }),
            }
            return Promise.resolve({ id: runId, workspaceId: WS, agentId: SALES, wakeId: `wake-${runId}`, trigger: "nivo.trigger.workflow.called", versionId: null, status: "running", context, errorCode: null, spoken: false })
        })
        const callLog = mock<ToolCallLogService>()
        callLog.connectionsUsedByRun.mockImplementation((_workspaceId, runId) => Promise.resolve(stored[runId]?.used ?? []))
        return { runs, callLog, sandbox: SANDBOX, ...(logger === undefined ? {} : { logger }) }
    }
    const both = [rowOf(SALES, "pay-live", "payos"), rowOf(SALES, "pay-sbx", "payos"), rowOf(SALES, "oa-sbx", "zalo_oa"), rowOf(SALES, "vcb", "sepay")]

    it("THE INCIDENT: a sale CALLED by a run woken on a sandbox line pays through the SANDBOX payOS, though the node lists the live one first", async () => {
        const runs = chain({ "run-sale": { caller: "run-desk" }, "run-desk": { trigger: "oa-sbx" } })
        const { service } = await build(PAY_ACCOUNTS, both, payNode, runs)

        await expect(service.boundAccountsOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toEqual([
            { provider: "payos", connectionId: "pay-sbx" },
            { provider: "sepay", connectionId: "vcb" },
        ])
        await expect(service.worldRefusalOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toBeNull()
    })

    it("the incident with ONLY the live payOS attached: binds nothing and refuses typed (other_world sandbox), never the live account", async () => {
        const runs = chain({ "run-sale": { caller: "run-desk" }, "run-desk": { trigger: "oa-sbx" } })
        const onlyLive = [rowOf(SALES, "pay-live", "payos"), rowOf(SALES, "oa-sbx", "zalo_oa")]
        const node: OptionalNodeRequest = { mode: "auto", accounts: [{ kind: "payment", provider: "payos", connectionId: "pay-live" }] }
        const { service } = await build(PAY_ACCOUNTS, onlyLive, node, runs)

        await expect(service.boundAccountsOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toEqual([])
        await expect(service.worldRefusalOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toEqual({ kind: "other_world", provider: "payos", world: "sandbox" })
        // A SINGLE-world agent (every attached account live) in a sandbox run is no exception: the old read condition skipped it.
        const allLive = await build(PAY_ACCOUNTS, [rowOf(SALES, "pay-live", "payos")], node, runs)
        await expect(allLive.service.boundAccountsOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toEqual([])
    })

    it("every rung is narrowed: a live trigger-, run-, node- or default-named account never binds in a sandbox run", async () => {
        const liveDefault = Object.assign(rowOf(SALES, "pay-live", "payos"), { isDefault: true })
        const rows = [liveDefault, rowOf(SALES, "pay-sbx", "payos"), rowOf(SALES, "oa-sbx", "zalo_oa")]
        const node: OptionalNodeRequest = { mode: "auto", accounts: [{ kind: "payment", provider: "payos", connectionId: "pay-live" }] }
        // The sandbox world comes from the caller; the run's OWN earlier call names the live account (a stale log line), the node names it,
        // and it is the agent's default: none of these rungs reaches it.
        const runs = chain({ "run-sale": { caller: "run-desk", used: ["pay-live"] }, "run-desk": { trigger: "oa-sbx" } })
        const { service } = await build(PAY_ACCOUNTS, rows, node, runs)
        await expect(service.boundAccountsOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toEqual([{ provider: "payos", connectionId: "pay-sbx" }])
    })

    it("a hand-off two calls deep inherits the first run's world; a cycle in the chain ends the walk", async () => {
        const deep = chain({ "run-sale": { caller: "run-mid" }, "run-mid": { caller: "run-desk" }, "run-desk": { trigger: "oa-sbx" } })
        const { service } = await build(PAY_ACCOUNTS, both, payNode, deep)
        await expect(service.boundAccountsOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toEqual([
            { provider: "payos", connectionId: "pay-sbx" },
            { provider: "sepay", connectionId: "vcb" },
        ])
        // A cycle with no account anywhere: nothing fixes the world, both payOS worlds serve: refused undecided, nothing bound.
        const loop = chain({ "run-sale": { caller: "run-mid" }, "run-mid": { caller: "run-sale" } })
        const looped = await build(PAY_ACCOUNTS, both, payNode, loop)
        await expect(looped.service.boundAccountsOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toEqual([])
        await expect(looped.service.worldRefusalOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toEqual({ kind: "undecided", provider: "payos" })
    })

    it("a LIVE caller gives a LIVE world: the called sale pays through the live payOS (the order of the node is not what decides)", async () => {
        const liveRows = [...both, rowOf(SALES, "oa-live", "zalo_oa")]
        const runs = chain({ "run-sale": { caller: "run-desk" }, "run-desk": { trigger: "oa-live" } })
        const { service } = await build(PAY_ACCOUNTS, liveRows, { ...payNode, accounts: [...(payNode?.accounts ?? [])].reverse() }, runs)
        await expect(service.boundAccountsOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toEqual([{ provider: "payos", connectionId: "pay-live" }])
    })

    it("second kind (a customer send, not a payment; outside a step and the multi-account reads too): the run's world narrows every road", async () => {
        const rows = [rowOf(SALES, "oa-live", "zalo_oa"), rowOf(SALES, "oa-sbx", "zalo_oa"), rowOf(SALES, "vcb", "sepay"), rowOf(SALES, "mb", "sepay")]
        const runs = chain({ "run-sale": { caller: "run-desk" }, "run-desk": { trigger: "oa-sbx" } })
        const zaloChosen: OptionalNodeRequest = {
            mode: "auto",
            accounts: [
                { kind: "messaging", provider: "zalo_oa", connectionId: "oa-live" },
                { kind: "messaging", provider: "zalo_oa", connectionId: "oa-sbx" },
            ],
        }
        const { service } = await build(PAY_ACCOUNTS, rows, zaloChosen, runs)
        await expect(service.boundAccountsOf(WS, SALES, SEND, FROM_NODE, CALLED)).resolves.toEqual([{ provider: "zalo_oa", connectionId: "oa-sbx" }])
        await expect(service.chosenAccountsOf(WS, SALES, FROM_NODE, CALLED)).resolves.toEqual([{ provider: "zalo_oa", connectionId: "oa-sbx" }])
        // Outside a step: every serving account of the run's world only; a read over several accounts likewise.
        await expect(service.boundAccountsOf(WS, SALES, BANK_TOOL, undefined, CALLED)).resolves.toEqual([{ provider: "sepay", connectionId: "vcb" }])
        await expect(service.accountsOfAgent(WS, SALES, BANK_TOOL, undefined, CALLED)).resolves.toEqual(["vcb"])
        // Without a run named, as before: every attached account.
        await expect(service.accountsOfAgent(WS, SALES, BANK_TOOL)).resolves.toEqual(["vcb", "mb"])
    })

    it("a stored node setting naming an account the agent is NOT attached to names nothing, and is reported once", async () => {
        const logger = mock<Logger>()
        const runs = chain({ "run-sale": { trigger: "oa-sbx" } }, logger)
        // `pay-gone` is in the stored setting but attached to no agent (detached after the setting was stored).
        const node: OptionalNodeRequest = {
            mode: "auto",
            accounts: [
                { kind: "payment", provider: "payos", connectionId: "pay-gone" },
                { kind: "payment", provider: "payos", connectionId: "pay-sbx" },
            ],
        }
        const { service } = await build(PAY_ACCOUNTS, both, node, runs)
        await expect(service.boundAccountsOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)).resolves.toEqual([{ provider: "payos", connectionId: "pay-sbx" }])
        await service.boundAccountsOf(WS, SALES, QR_TOOL, FROM_NODE, CALLED)
        const skipped = logger.warn.mock.calls.filter(([event]) => event === "tools.node-setting.account-skipped")
        expect(skipped).toHaveLength(1)
        expect(skipped[0]?.[1]).toEqual(expect.objectContaining({ connectionId: "pay-gone", nodeKey: STEP.nodeKey }))
    })
})
