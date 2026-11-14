import { Test } from "@nestjs/testing"
import type { NodeDefinition } from "@nivo-lite/agent-sdk/node"
import { mock } from "@starci/jest-preset"
import { GraphNodeRegistryService } from "@modules/domain/graph-nodes"
import { WorkspaceMembersReadService } from "@modules/domain/workspace-members"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import { MESSAGE_CATALOG } from "@modules/platform/i18n"
import type { MessageCatalog } from "@modules/platform/i18n"
import {
    OWNER_EXAMPLE,
    approverOf,
    branchOf,
    contextOf,
    graphOf,
    stateOf,
} from "@tests/fixtures/builders/agent-graph.builder"
import { AgentGraphContextService } from "./agent-graph-context.service"
import { AgentGraphViewService } from "./agent-graph-view.service"
import { AgentGraphsError, AgentGraphsErrorCode } from "./errors/agent-graphs.error"
import { AgentGraphsService } from "./agent-graphs.service"
import type { OptionalGraphState } from "./agent-graphs.service"

const build = async (state: OptionalGraphState, installed = true) => {
    const graphs = mock<AgentGraphsService>({ stateOfAgent: jest.fn().mockResolvedValue(state) })
    const context = mock<AgentGraphContextService>({ contextOf: jest.fn().mockResolvedValue(contextOf()) })
    const installations = mock<InstallationRecordsService>({
        findById: jest
            .fn()
            .mockResolvedValue(
                installed ? { id: "inst-1", moduleKey: "accounting", activeContextVersionId: "context-1" } : null,
            ),
    })
    const members = mock<WorkspaceMembersReadService>({
        directory: jest
            .fn()
            .mockResolvedValue([
                { id: "dinh", user_id: "user-dinh", display_name: "Dinh", role: "manager", status: "active" },
            ]),
    })
    const catalog = mock<MessageCatalog>({
        get: jest.fn((key: string, params?: Record<string, string | number>) => `[${key}${params?.name ?? ""}]`),
    })
    const nodes = mock<GraphNodeRegistryService>({
        installed: jest.fn().mockReturnValue(
            mock<ReturnType<GraphNodeRegistryService["installed"]>>({
                nodes: new Map([
                    [
                        "sales.consult",
                        mock<NodeDefinition>({ id: "sales.consult", title: { vi: "Tu van", en: "Consult" } }),
                    ],
                    [
                        "sales.consult-route",
                        mock<NodeDefinition>({ id: "sales.consult-route", title: { key: "k.route" } }),
                    ],
                ]),
            }),
        ),
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            AgentGraphViewService,
            { provide: AgentGraphsService, useValue: graphs },
            { provide: AgentGraphContextService, useValue: context },
            { provide: InstallationRecordsService, useValue: installations },
            { provide: WorkspaceMembersReadService, useValue: members },
            { provide: MESSAGE_CATALOG, useValue: catalog },
            { provide: GraphNodeRegistryService, useValue: nodes },
        ],
    }).compile()
    return { service: moduleRef.get(AgentGraphViewService) }
}

describe("AgentGraphViewService.viewOf", () => {
    it("shows the draft with its gaps, its problems, and a card for every node", async () => {
        const { service } = await build(stateOf({ mode: "enforced" }))

        const view = await service.viewOf("ws-1", "agent-1", "en")

        expect(view).toMatchObject({
            agentId: "agent-1",
            installationId: "inst-1",
            mode: "enforced",
            draftRev: 1,
            isDraftChanged: false,
            activeVersionId: "version-1",
            gaps: [],
            problems: [],
        })
        expect(view.cards.map((card) => card.id)).toEqual(["start", "decide", "act", "ask", "end"])
    })

    it("names the person who approves on the card, in the catalog words of the language asked", async () => {
        const ask = graphOf([branchOf({ key: "else", when: "else", mode: "ask", next: "ask", approver: approverOf() })])
        const { service } = await build(stateOf({ draft: ask }))

        const view = await service.viewOf("ws-1", "agent-1", "vi")

        expect(view.cards.find((card) => card.id === "ask")?.description).toBe("[agentGraphs.card.approvesDinh]")
        expect(view.cards.find((card) => card.id === "act")?.description).toBe("")
    })

    it("says the draft has something to publish when it differs from the version that decides", async () => {
        const edited = graphOf([
            branchOf({ key: "else", when: "else", mode: "ask", next: "ask", approver: approverOf() }),
        ])
        const { service } = await build(stateOf({ draft: edited }))

        const view = await service.viewOf("ws-1", "agent-1", "en")

        expect(view.isDraftChanged).toBe(true)
    })

    it("lists what is wrong and what is vague in the draft", async () => {
        const vague = graphOf([branchOf({ key: "else", when: "else", mode: "ask", next: "ask", approver: null })])
        const { service } = await build(stateOf({ draft: vague }))

        const view = await service.viewOf("ws-1", "agent-1", "en")

        expect(view.problems.map((problem) => problem.code)).toEqual(["approver_missing"])
        expect(view.gaps.map((gap) => gap.code)).toEqual(["approver_missing"])
    })

    it("offers the facts a condition may be written on, in the words of the language asked", async () => {
        const { service } = await build(stateOf())

        const view = await service.viewOf("ws-1", "agent-1", "vi")

        expect(view.facts).toContainEqual({
            key: "supplier_payment.kind",
            label: "[fact.kind]",
            type: "string",
            unit: null,
            allowed: ["rent", "stock"],
        })
        expect(view.facts.map((fact) => fact.key)).toHaveLength(3)
    })
})

describe("AgentGraphViewService.viewOf refusals", () => {
    it("refuses an agent with no graph, and a graph whose installation is gone", async () => {
        const { service: none } = await build(null)
        const { service: gone } = await build(stateOf(), false)

        await expect(none.viewOf("ws-1", "agent-1", "en")).rejects.toEqual(
            expect.objectContaining({ code: AgentGraphsErrorCode.GraphNotFound }),
        )
        await expect(gone.viewOf("ws-1", "agent-1", "en")).rejects.toBeInstanceOf(AgentGraphsError)
        expect(OWNER_EXAMPLE).toHaveLength(3)
    })
})

describe("AgentGraphViewService.viewOf the warnings of the contracts", () => {
    it("shows a contract the graph cannot use as a warning that stops nothing", async () => {
        const draft = {
            ...graphOf(OWNER_EXAMPLE),
            contracts: [{ intent: "give_discount", task: "", limits: [], sources: [] }],
        }
        const { service } = await build(stateOf({ draft }))

        const view = await service.viewOf("ws-1", "agent-1", "en")

        expect(view.problems).toEqual([])
        expect(view.warnings.map((warning) => [warning.code, warning.detail])).toEqual([
            ["contract_unknown_intent", "give_discount"],
            ["contract_no_task", "give_discount"],
        ])
    })

    it("shows none for a graph with no contracts block", async () => {
        const { service } = await build(stateOf())

        await expect(service.viewOf("ws-1", "agent-1", "en")).resolves.toMatchObject({ warnings: [] })
    })
})

describe("AgentGraphViewService flow cards", () => {
    it("adds a card for every node of the flow, titled in the owner's language, with its group and wait", async () => {
        const flow = {
            schema: "nivo/agent-graph@1",
            moduleKey: "sales",
            trigger: { kind: "tag", sources: ["agent"] },
            grant: { tools: [], effects: [] },
            nodes: [
                { key: "consult", kind: "output", step: "sales.consult", group: "consult", next: "route" },
                { key: "route", kind: "condition", step: "sales.consult-route", group: "consult", routes: {} },
                { key: "pay", kind: "execute", step: "sales.care-await", wait: { kind: "payment", reminder: "2h" } },
            ],
        } as const
        const { service } = await build(stateOf({ draft: { nodes: [], flow } }))

        const view = await service.viewOf("ws-1", "agent-1", "en")

        expect(view.cards.map((card) => [card.id, card.label, card.group, card.wait?.kind])).toEqual([
            ["consult", "Consult", "consult", undefined],
            ["route", "[k.route]", "consult", undefined],
            ["pay", "pay", undefined, "payment"],
        ])
    })
})
