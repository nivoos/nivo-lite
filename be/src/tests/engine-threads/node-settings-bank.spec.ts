import { Test } from "@nestjs/testing"
import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { mock, mockEntityManager } from "@starci/jest-preset"
import { AgentGraphsService } from "@modules/domain/agent-graphs/agent-graphs.service"
import { AgentNodeRequestsService } from "@modules/domain/agent-graphs/agent-node-requests.service"
import { graphWithNodeSettings, unsettableRefusal } from "@modules/domain/agent-graphs/policies/node-settings.policy"
import { AgentDirectoryService } from "@modules/domain/agents"
import { AgentRunsService } from "@modules/domain/agent-runs"
import { ConnectionBindingsReadService } from "@modules/domain/connections"
import { ConnectionEntity } from "@modules/domain/connections/persistence/entities"
import { ToolCallLogService } from "@modules/domain/tool-call-log"
import { AccountAttachmentsService, toolGrantsEntities } from "@modules/domain/tool-grants"
import { AgentAccountsService } from "@modules/domain/tools"
import { NODE_REQUESTS_GATE } from "@modules/domain/tools/node-requests.decorators"
import { LOGGER } from "@modules/platform/logging"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"

// NODE-SETTINGS, the SECOND KIND (R75): a bank / payment step, no person, no channel. The step lists the bank feed provider; the agent
// holds TWO bank accounts. The call-time pick (THE ONE ORDER, `pickAccountOf`): the event's account, the run's account, the step's
// CHOSEN accounts in try order, the agent's default, else the typed `TOOLS_ACCOUNT_NEEDS_PICK` (what `pickNeeded` names, which the
// ToolRunner throws). Real: the door's pure write of the choice (`graphWithNodeSettings`), the stored version read back as JSON, the node
// request read of the PINNED version (`AgentNodeRequestsService`), the attachment store and the account pick (`AgentAccountsService`).

const WS = "ws-1"
const SALES = "agent-sales"
const BANK_TOOL = "nivo.tool.bank.transaction.list"
const [MB, VCB] = ["bank-mb", "bank-vcb"] as const
const VERSION = "agent-sales:payment@4"
const STEP = { origin: "node" as const, node: { nodeKey: "read-credits", versionId: VERSION, workflowId: "wf-payment" } }
const RUN = { runId: "run-1" }

/** A stored run, as the run reader answers it. */
type RunView = NonNullable<Awaited<ReturnType<AgentRunsService["runOf"]>>>

const [, AccountAttachmentEntity] = toolGrantsEntities

/** The payment workflow as the template states it: one step reading the bank feed. */
const TEMPLATE: GraphSpec = {
    schema: "nivo/agent-graph@1",
    moduleKey: "sales",
    trigger: { kind: "tag", sources: ["agent"] },
    grant: { tools: [BANK_TOOL], effects: [] },
    nodes: [
        {
            key: "read-credits",
            kind: "execute",
            step: "sales.read-credits",
            mode: "auto",
            accounts: [{ kind: "payment", provider: "sepay", connectionId: null }],
            next: "end",
        },
        { key: "end", kind: "output", step: "stop" },
    ],
}

/** The stored version: the template with the step's accounts chosen (the door's write), read back as JSON. */
const storedWith = (accounts: ReadonlyArray<string>): GraphSpec => {
    const written =
        accounts.length === 0
            ? TEMPLATE
            : graphWithNodeSettings(
                  TEMPLATE,
                  "read-credits",
                  { accounts: accounts.map((connectionId) => ({ provider: "sepay", connectionId })) },
                  unsettableRefusal,
              )
    if (written === null) throw new Error("the choice changed nothing")
    const stored: GraphSpec = JSON.parse(JSON.stringify(written))
    return stored
}

/** The accounts' pick over the real attachment store and the real node request read of the pinned version. */
const pickOf = async (stored: GraphSpec, defaultId: string | null, trigger: string | null = null) => {
    const rows = [MB, VCB].map((connectionId) =>
        Object.assign(new AccountAttachmentEntity(), {
            id: `${SALES}:${connectionId}`,
            workspaceId: WS,
            agentId: SALES,
            connectionId,
            provider: "sepay",
            updatedBy: "owner-1",
            isDefault: connectionId === defaultId,
        }),
    )
    const entityManager = mockEntityManager({
        find: [
            [AccountAttachmentEntity, rows],
            [ConnectionEntity, [MB, VCB].map((id) => Object.assign(new ConnectionEntity(), { id }))],
        ],
    })
    const graphs = mock<AgentGraphsService>({
        versionAt: (_ws: string, _agent: string, versionId: string) =>
            versionId === VERSION
                ? Promise.resolve({ version: 4, document: { nodes: [], flow: stored } })
                : Promise.reject(new Error(`no version ${versionId}`)),
    })
    const runs = mock<AgentRunsService>()
    runs.runOf.mockResolvedValue(
        mock<RunView>({ id: RUN.runId, workspaceId: WS, agentId: SALES, context: trigger === null ? {} : { connectionId: trigger } }),
    )
    const callLog = mock<ToolCallLogService>()
    callLog.connectionsUsedByRun.mockResolvedValue([])
    const moduleRef = await Test.createTestingModule({
        providers: [
            AgentAccountsService,
            AccountAttachmentsService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: entityManager },
            { provide: AgentDirectoryService, useValue: mock<AgentDirectoryService>() },
            { provide: ConnectionBindingsReadService, useValue: mock<ConnectionBindingsReadService>() },
            { provide: NODE_REQUESTS_GATE, useValue: new AgentNodeRequestsService(graphs, mock()) },
            { provide: AgentRunsService, useValue: runs },
            { provide: ToolCallLogService, useValue: callLog },
            { provide: LOGGER, useValue: mock() },
        ],
    }).compile()
    const service = moduleRef.get(AgentAccountsService)
    return {
        bound: await service.boundAccountsOf(WS, SALES, BANK_TOOL, STEP, RUN),
        needed: await service.pickNeeded(WS, SALES, BANK_TOOL, STEP, RUN),
    }
}

describe("node settings, second kind: a bank step with two attached bank accounts", () => {
    it("the step's CHOSEN account is used, over the agent's default", async () => {
        await expect(pickOf(storedWith([VCB]), MB)).resolves.toEqual({
            bound: [{ provider: "sepay", connectionId: VCB }],
            needed: null,
        })
    })

    it("the choice is a try order: a first choice the agent no longer holds names nothing, the next one is used", async () => {
        await expect(pickOf(storedWith(["bank-gone", MB]), VCB)).resolves.toMatchObject({ bound: [{ connectionId: MB }] })
    })

    it("without a choice the agent's default is used", async () => {
        await expect(pickOf(storedWith([]), MB)).resolves.toEqual({ bound: [{ provider: "sepay", connectionId: MB }], needed: null })
    })

    it("with neither a choice nor a default: nothing is bound and the typed choice to make is named (TOOLS_ACCOUNT_NEEDS_PICK)", async () => {
        await expect(pickOf(storedWith([]), null)).resolves.toEqual({
            bound: [],
            needed: { provider: "sepay", connectionIds: [MB, VCB] },
        })
    })

    it("the account the event came in on still comes first: an event on one account is acted on there, whatever the step chose", async () => {
        await expect(pickOf(storedWith([VCB]), null, MB)).resolves.toMatchObject({ bound: [{ connectionId: MB }], needed: null })
    })
})
