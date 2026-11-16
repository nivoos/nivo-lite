import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import { stateOf } from "@tests/fixtures/builders/agent-graph.builder"
import { AgentGraphSeedService } from "./agent-graph-seed.service"
import { AgentGraphWatchService } from "./agent-graph-watch.service"
import { AgentGraphsService } from "./agent-graphs.service"

interface Row {
    id: string
    agentId: string | null
    workspaceId: string
    moduleKey: string
}

const rowOf = (id: string, agentId: string | null): Row => ({
    id,
    agentId,
    workspaceId: "ws-1",
    moduleKey: "accounting",
})

const build = async (
    options: {
        pages?: ReadonlyArray<ReadonlyArray<Row>>
        moved?: boolean
        missing?: ReadonlyArray<string>
        seeded?: boolean
        state?: ReturnType<typeof stateOf> | null
    } = {},
) => {
    const pages = options.pages ?? [[rowOf("inst-1", "agent-1")]]
    const installations = mock<InstallationRecordsService>({
        page: jest.fn().mockImplementation((after: string) => {
            const index = after === "" ? -1 : pages.findIndex((page) => page.at(-1)?.id === after)
            return Promise.resolve(pages[index + 1] ?? [])
        }),
    })
    const graphs = mock<AgentGraphsService>({
        missingGraph: jest.fn().mockResolvedValue(options.missing ?? ["agent-1"]),
        stateOfAgent: jest
            .fn()
            .mockResolvedValue(options.state === undefined ? stateOf({ mode: "enforced" }) : options.state),
    })
    const seed = mock<AgentGraphSeedService>({
        ensureFor: jest.fn().mockResolvedValue(options.seeded === false ? null : stateOf()),
        refresh: jest.fn().mockResolvedValue(options.moved ?? false),
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            AgentGraphWatchService,
            { provide: InstallationRecordsService, useValue: installations },
            { provide: AgentGraphsService, useValue: graphs },
            { provide: AgentGraphSeedService, useValue: seed },
        ],
    }).compile()
    return {
        service: moduleRef.get(AgentGraphWatchService),
        installations,
        graphs,
        seed,
    }
}

describe("AgentGraphWatchService seeding", () => {
    it("gives the graph to an agent that has none, and walks the installations page by page", async () => {
        const { service, seed, installations } = await build()

        await expect(service.tick()).resolves.toMatchObject({ seeded: 1 })

        expect(seed.ensureFor).toHaveBeenCalledWith("inst-1", "vi")
        expect(installations.page.mock.calls.map((call) => call[0])).toEqual(["", "inst-1", "", "inst-1"])
    })

    it("leaves alone an installation with no agent and an agent that has a graph, and counts only the seeds that happened", async () => {
        const none = await build({
            pages: [[rowOf("inst-1", null), rowOf("inst-2", "agent-2")]],
            missing: [],
        })
        const refused = await build({ seeded: false })

        await expect(none.service.tick()).resolves.toMatchObject({ seeded: 0 })
        await expect(refused.service.tick()).resolves.toMatchObject({ seeded: 0 })
        expect(none.seed.ensureFor).not.toHaveBeenCalled()
    })

    it("seeds at most fifty agents in one tick", async () => {
        const many = Array.from({ length: 60 }, (_unused, index) => rowOf(`inst-${index}`, `agent-${index}`))
        const { service, seed, graphs } = await build({ pages: [many] })
        graphs.missingGraph.mockResolvedValue(many.map((_row, index) => `agent-${index}`))

        await expect(service.tick()).resolves.toMatchObject({ seeded: 50 })
        expect(seed.ensureFor).toHaveBeenCalledTimes(50)
    })
})

describe("AgentGraphWatchService refreshing", () => {
    it("brings a seed up to its rule, for the installation of the agent and its module", async () => {
        const { service, seed, graphs } = await build({ missing: [], moved: true })

        await expect(service.tick()).resolves.toMatchObject({ refreshed: 1 })

        expect(graphs.stateOfAgent).toHaveBeenCalledWith("ws-1", "agent-1")
        expect(seed.refresh).toHaveBeenCalledWith(stateOf({ mode: "enforced" }), "accounting", "vi")
    })

    it("counts only the seeds that moved, and reads nothing of an installation with no agent or an agent with no graph", async () => {
        const stays = await build({ missing: [] })
        const noAgent = await build({ missing: [], moved: true, pages: [[rowOf("inst-1", null)]] })
        const noGraph = await build({ missing: [], moved: true, state: null })

        await expect(stays.service.tick()).resolves.toMatchObject({ refreshed: 0 })
        await expect(noAgent.service.tick()).resolves.toMatchObject({ refreshed: 0 })
        await expect(noGraph.service.tick()).resolves.toMatchObject({ refreshed: 0 })
        expect(noAgent.graphs.stateOfAgent).not.toHaveBeenCalled()
        expect(noGraph.seed.refresh).not.toHaveBeenCalled()
    })

    it("moves at most fifty seeds in one tick, across pages", async () => {
        const rows = Array.from({ length: 90 }, (_unused, index) => rowOf(`inst-${index}`, `agent-${index}`))
        const pages = [rows.slice(0, 30), rows.slice(30, 60), rows.slice(60)]
        const { service, seed } = await build({ pages, missing: [], moved: true })

        await expect(service.tick()).resolves.toMatchObject({ refreshed: 50 })
        expect(seed.refresh).toHaveBeenCalledTimes(50)
    })

    it("walks at most ten pages of installations", async () => {
        const pages = Array.from({ length: 12 }, (_unused, index) => [rowOf(`inst-${index}`, `agent-${index}`)])
        const { service, seed } = await build({ pages, missing: [] })

        await service.tick()

        expect(seed.refresh).toHaveBeenCalledTimes(10)
    })
})

describe("AgentGraphWatchService proposes nothing", () => {
    it("answers only what it seeded and refreshed: a stored graph is a template version, so no Brain rule raises a graph proposal", async () => {
        const { service } = await build({ missing: [], moved: true })

        await expect(service.tick()).resolves.toEqual({ seeded: 0, refreshed: 1 })
    })
})

describe("AgentGraphWatchService the workspaces of a tick", () => {
    it("asks which agents lack a graph one workspace at a time", async () => {
        const rows = [
            { ...rowOf("inst-1", "agent-1"), workspaceId: "ws-1" },
            { ...rowOf("inst-2", "agent-2"), workspaceId: "ws-2" },
            { ...rowOf("inst-3", "agent-3"), workspaceId: "ws-1" },
        ]
        const { service, graphs } = await build({ pages: [rows], missing: [] })

        await service.tick()

        expect(graphs.missingGraph.mock.calls.slice(0, 2)).toEqual([
            ["ws-1", ["agent-1", "agent-3"]],
            ["ws-2", ["agent-2"]],
        ])
    })
})
