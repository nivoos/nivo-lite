import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import type { GraphSpec } from "@nivo-lite/agent-sdk/graph"
import { coreTemplates } from "@modules/domain/installed-plugins/installed-plugins.testing"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import {
    OWNER_EXAMPLE,
    amountIs,
    approverOf,
    branchOf,
    contextOf,
    graphOf,
    nodeOf,
    stateOf,
} from "@tests/fixtures/builders/agent-graph.builder"
import { AgentGraphContextService } from "./agent-graph-context.service"
import { AgentGraphPublishService } from "./agent-graph-publish.service"
import type { Publisher } from "./agent-graph-publish.service"
import { AgentGraphsError, AgentGraphsErrorCode } from "./errors/agent-graphs.error"
import { AgentGraphsService } from "./agent-graphs.service"
import type { GraphState, OptionalGraphState } from "./agent-graphs.service"
import type { GraphContext, GraphDocument } from "./agent-graphs.contracts"

const OWNER: Publisher = { memberId: "boss", role: "owner" }
const MANAGER: Publisher = { memberId: "dinh", role: "manager" }
const VERSION = {
    id: "version-2",
    version: 2,
    changeKind: "edit",
    note: "",
    publishedAt: "2026-11-01T00:00:00.000Z",
    publishedBy: "boss",
}
const INSTALLATION = { id: "inst-1", moduleKey: "accounting" }

/** An installed core template version's graph: the one format a flow takes. */
const FLOW: GraphSpec = (() => {
    const graph = coreTemplates()[0]?.versions[0]?.graph
    if (graph === undefined) throw new Error("the core package ships no template")
    return graph
})()

const build = async (state: OptionalGraphState, options: { context?: GraphContext; installation?: boolean } = {}) => {
    const graphs = mock<AgentGraphsService>({
        stateOfAgent: jest.fn().mockResolvedValue(state),
        publish: jest.fn().mockResolvedValue(VERSION),
        documentOf: jest.fn().mockResolvedValue(graphOf(OWNER_EXAMPLE)),
    })
    const context = mock<AgentGraphContextService>({
        contextOf: jest.fn().mockResolvedValue(options.context ?? contextOf()),
    })
    const installations = mock<InstallationRecordsService>({
        findById: jest.fn().mockResolvedValue(options.installation === false ? null : INSTALLATION),
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            AgentGraphPublishService,
            { provide: AgentGraphsService, useValue: graphs },
            { provide: AgentGraphContextService, useValue: context },
            { provide: InstallationRecordsService, useValue: installations },
        ],
    }).compile()
    return { service: moduleRef.get(AgentGraphPublishService), graphs, context }
}

const codeOf = async (work: Promise<unknown>): Promise<unknown> => {
    try {
        await work
        return null
    } catch (cause) {
        return cause instanceof AgentGraphsError ? cause.code : cause
    }
}

const raised = (state: GraphState): GraphDocument => ({
    ...state.draft,
    nodes: state.draft.nodes.map((node) =>
        node.decide === undefined
            ? node
            : {
                  ...node,
                  decide: {
                      ...node.decide,
                      branches: [
                          branchOf({ key: "small", when: amountIs("lt", 6_000_000) }),
                          branchOf({
                              key: "middle",
                              when: { all: [amountIs("gte", 6_000_000), amountIs("lt", 20_000_000)] },
                              mode: "ask",
                              next: "ask",
                              approver: approverOf(),
                          }),
                          ...node.decide.branches.slice(2),
                      ],
                  },
              },
    ),
})

describe("AgentGraphPublishService.publishDraft", () => {
    it("publishes a draft that is whole and does not widen, and an owner's publish leaves the mode alone", async () => {
        const state = stateOf()
        const { service, graphs, context } = await build(state)

        await expect(service.publishDraft("ws-1", "agent-1", OWNER, "Tidied", "edit")).resolves.toBe(VERSION)

        expect(context.contextOf).toHaveBeenCalledWith(
            expect.objectContaining({ agentId: "agent-1", moduleKey: "accounting" }),
        )
        expect(graphs.publish).toHaveBeenCalledWith({
            workspaceId: "ws-1",
            agentId: "agent-1",
            document: state.draft,
            kind: "edit",
            note: "Tidied",
            memberId: "boss",
            contextVersionId: null,
        })
    })

    it("lets a manager publish what does not widen, without changing the mode", async () => {
        const { service, graphs } = await build(stateOf())

        await service.publishDraft("ws-1", "agent-1", MANAGER, "")

        expect(graphs.publish).toHaveBeenCalledWith(expect.objectContaining({ kind: "edit", memberId: "dinh" }))
    })

    it("refuses a manager a change that widens the reach of the agent, and lets the owner make it", async () => {
        const base = stateOf()
        const state = stateOf({ draft: raised(base) })
        const manager = await build(state)
        const owner = await build(state)

        expect(await codeOf(manager.service.publishDraft("ws-1", "agent-1", MANAGER, ""))).toBe(
            AgentGraphsErrorCode.WidensNeedsOwner,
        )
        await expect(owner.service.publishDraft("ws-1", "agent-1", OWNER, "")).resolves.toBe(VERSION)
        expect(manager.graphs.publish).not.toHaveBeenCalled()
    })

    it("compares a first publish with an empty graph, so everything it grants counts as new", async () => {
        const { service } = await build(stateOf({ active: null, activeVersionId: null }))

        expect(await codeOf(service.publishDraft("ws-1", "agent-1", MANAGER, ""))).toBe(
            AgentGraphsErrorCode.WidensNeedsOwner,
        )
    })

    it("refuses a graph with a problem the owner must fix first", async () => {
        const blank = graphOf(OWNER_EXAMPLE)
        const state = stateOf({
            draft: { ...blank, nodes: [...blank.nodes, nodeOf({ key: "blank", does: "", next: ["end"] })] },
        })
        const { service, graphs } = await build(state)

        expect(await codeOf(service.publishDraft("ws-1", "agent-1", OWNER, ""))).toBe(
            AgentGraphsErrorCode.PublishRefused,
        )
        expect(graphs.publish).not.toHaveBeenCalled()
    })

    it("refuses an agent with no graph and a graph whose installation is gone", async () => {
        const none = await build(null)
        const gone = await build(stateOf(), { installation: false })

        expect(await codeOf(none.service.publishDraft("ws-1", "agent-1", OWNER, ""))).toBe(
            AgentGraphsErrorCode.GraphNotFound,
        )
        expect(await codeOf(gone.service.publishDraft("ws-1", "agent-1", OWNER, ""))).toBe(
            AgentGraphsErrorCode.GraphNotFound,
        )
    })
})

describe("AgentGraphPublishService.publishDraft from the setup chat", () => {
    it("preserves the owner's shadow mode when publishing from the setup chat and numbers the version as asked", async () => {
        const state = stateOf({ mode: "shadow" })
        const { service, graphs } = await build(state)

        await expect(service.publishDraft("ws-1", "agent-1", OWNER, "", "chat", "cv-7", 7)).resolves.toBe(VERSION)

        expect(graphs.publish).toHaveBeenCalledWith({
            workspaceId: "ws-1",
            agentId: "agent-1",
            document: state.draft,
            kind: "chat",
            note: "",
            memberId: "boss",
            contextVersionId: "cv-7",
            version: 7,
        })
    })

})

describe("AgentGraphPublishService.requirePublishable", () => {
    it("passes a draft that is whole and does not widen, writing nothing", async () => {
        const { service, graphs } = await build(stateOf())

        await expect(service.requirePublishable("ws-1", "agent-1", MANAGER)).resolves.toBeUndefined()

        expect(graphs.publish).not.toHaveBeenCalled()
    })

    it("refuses a manager a widening with its own code, lets the owner through, and refuses an agent with no graph", async () => {
        const state = stateOf({ draft: raised(stateOf()) })
        const manager = await build(state)
        const owner = await build(state)
        const none = await build(null)

        expect(await codeOf(manager.service.requirePublishable("ws-1", "agent-1", MANAGER))).toBe(
            AgentGraphsErrorCode.WidensNeedsOwner,
        )
        await expect(owner.service.requirePublishable("ws-1", "agent-1", OWNER)).resolves.toBeUndefined()
        expect(await codeOf(none.service.requirePublishable("ws-1", "agent-1", OWNER))).toBe(
            AgentGraphsErrorCode.GraphNotFound,
        )
    })
})

describe("AgentGraphPublishService.publishDraft without a fact counted in dong", () => {
    it("compares a graph with no amount in it when the module has no fact counted in dong", async () => {
        const draft: GraphDocument = { nodes: [] }
        const { service, graphs } = await build(stateOf({ draft }), { context: { ...contextOf(), facts: {} } })

        await expect(service.publishDraft("ws-1", "agent-1", OWNER, "Bare")).resolves.toBe(VERSION)

        expect(graphs.publish).toHaveBeenCalledWith(expect.objectContaining({ document: draft }))
    })
})

describe("AgentGraphPublishService, a node graph", () => {
    it("publishes a version whose flow is an installed template version's copy, by the owner", async () => {
        const { service, graphs } = await build(stateOf())
        const document = { ...stateOf().draft, flow: FLOW }

        await expect(service.publishCopy("ws-1", "agent-1", document, OWNER)).resolves.toBe(VERSION)

        expect(graphs.publish).toHaveBeenCalledWith(expect.objectContaining({ document }))
    })

    it("refuses a flow that is no installed template version's copy, and a change of it by anyone but the owner", async () => {
        const { service, graphs } = await build(stateOf())
        const ghost = { ...FLOW, nodes: [{ key: "x", kind: "output" as const, step: "core.ghost" }] }

        expect(
            await codeOf(service.publishCopy("ws-1", "agent-1", { ...stateOf().draft, flow: ghost }, OWNER)),
        ).toBe(AgentGraphsErrorCode.PublishRefused)
        expect(
            await codeOf(service.publishCopy("ws-1", "agent-1", { ...stateOf().draft, flow: FLOW }, MANAGER)),
        ).toBe(AgentGraphsErrorCode.WidensNeedsOwner)
        expect(graphs.publish).not.toHaveBeenCalled()
    })
})

describe("AgentGraphPublishService the contracts of a graph", () => {
    it("publishes a graph with no contracts block, and a contract that only warns", async () => {
        const warned = {
            ...stateOf().draft,
            contracts: [{ intent: "give_discount", task: "", limits: [], sources: [] }],
        }
        const context = contextOf()
        const shipped = await build(stateOf(), { context })
        const warning = await build(stateOf({ draft: warned }), { context })

        await expect(shipped.service.publishDraft("ws-1", "agent-1", OWNER, "Edit")).resolves.toBe(VERSION)
        await expect(warning.service.publishDraft("ws-1", "agent-1", OWNER, "Edit")).resolves.toBe(VERSION)
    })
})

describe("AgentGraphPublishService.publishCopy", () => {
    it("publishes the graph of a sibling agent as a version of kind copy", async () => {
        const state = stateOf({ activeKind: "seed" })
        const { service, graphs } = await build(state)

        await expect(service.publishCopy("ws-1", "agent-1", state.draft, OWNER)).resolves.toBe(VERSION)

        expect(graphs.publish).toHaveBeenCalledWith(expect.objectContaining({ kind: "copy", memberId: "boss" }))
    })

    it("still refuses a manager a copy that widens what the agent may do", async () => {
        const state = stateOf({ activeKind: "seed" })
        const { service, graphs } = await build(state)

        expect(await codeOf(service.publishCopy("ws-1", "agent-1", raised(state), MANAGER))).toBe(
            AgentGraphsErrorCode.WidensNeedsOwner,
        )
        expect(graphs.publish).not.toHaveBeenCalled()
    })
})
