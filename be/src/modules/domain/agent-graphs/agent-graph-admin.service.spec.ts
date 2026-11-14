import { Test } from "@nestjs/testing"
import { mock } from "@starci/jest-preset"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import { WorkspaceMemberSeatsService } from "@modules/domain/workspace-members"
import { stateOf } from "@tests/fixtures/builders/agent-graph.builder"
import { AgentGraphAdminService } from "./agent-graph-admin.service"
import { AgentGraphSeedService } from "./agent-graph-seed.service"
import { AgentGraphViewService } from "./agent-graph-view.service"
import { AgentGraphsError, AgentGraphsErrorCode } from "./errors/agent-graphs.error"
import { AgentGraphsService } from "./agent-graphs.service"
import type { OptionalGraphState } from "./agent-graphs.service"

const ACTOR = { workspaceId: "ws-1", principalId: "user-1" }
const VIEW = { agentId: "agent-1" }
const VERSION = { id: "version-2" }

const build = async (
    options: {
        role?: "owner" | "manager" | "staff" | null
        state?: OptionalGraphState
        installed?: boolean
    } = {},
) => {
    const role = options.role === undefined ? "manager" : options.role
    const seats = mock<WorkspaceMemberSeatsService>({
        activeSeatOfUser: jest
            .fn()
            .mockResolvedValue(
                role === null
                    ? null
                    : { memberId: "member-1", userId: "user-1", role, displayName: "An", status: "active" },
            ),
    })
    const graphs = mock<AgentGraphsService>({
        stateOfAgent: jest.fn().mockResolvedValue(options.state === undefined ? stateOf() : options.state),
        versionsOf: jest.fn().mockResolvedValue([VERSION]),
    })
    const seed = mock<AgentGraphSeedService>({ ensureFor: jest.fn().mockResolvedValue(stateOf()) })
    const view = mock<AgentGraphViewService>({ viewOf: jest.fn().mockResolvedValue(VIEW) })
    const installations = mock<InstallationRecordsService>({
        ofAgent: jest.fn().mockResolvedValue(options.installed === false ? null : { id: "inst-1" }),
    })
    const moduleRef = await Test.createTestingModule({
        providers: [
            AgentGraphAdminService,
            { provide: WorkspaceMemberSeatsService, useValue: seats },
            { provide: AgentGraphsService, useValue: graphs },
            { provide: AgentGraphSeedService, useValue: seed },
            { provide: AgentGraphViewService, useValue: view },
            { provide: InstallationRecordsService, useValue: installations },
        ],
    }).compile()
    const service = moduleRef.get(AgentGraphAdminService)
    return { service, graphs, seed, view }
}

// The action graph has READ doors only (owner ruling R89: a stored graph is exactly an installed template version). The write doors
// (save draft, publish, restore, set mode, confirm / decline a proposal, contract from a gap) were deleted with their GraphQL types by
// NODE-SETTINGS: the one change a shop makes is a node's settings, through `AgentWorkflowsAdminService.setNodeSettings`.
describe("AgentGraphAdminService access", () => {
    it.each([["staff" as const], [null]])("refuses a seat that is %s, whatever the call", async (role) => {
        const { service } = await build({ role })

        await expect(service.open(ACTOR, "agent-1", "vi")).rejects.toEqual(
            expect.objectContaining({ code: AgentGraphsErrorCode.Forbidden }),
        )
        await expect(service.versions(ACTOR, "agent-1")).rejects.toBeInstanceOf(AgentGraphsError)
        await expect(service.run(ACTOR, "item")).rejects.toBeInstanceOf(AgentGraphsError)
        await expect(service.coverage(ACTOR, "agent-1")).rejects.toBeInstanceOf(AgentGraphsError)
    })

    it("has no door that writes a graph", () => {
        const doors = Object.getOwnPropertyNames(AgentGraphAdminService.prototype).filter((name) => name !== "constructor")

        expect(doors.sort()).toEqual(["coverage", "open", "publisherOf", "run", "versions"])
    })
})

describe("AgentGraphAdminService.open", () => {
    it("opens a graph that exists without seeding it", async () => {
        const { service, seed, view } = await build()

        await expect(service.open(ACTOR, "agent-1", "en")).resolves.toMatchObject({ agentId: "agent-1" })

        expect(seed.ensureFor).not.toHaveBeenCalled()
        expect(view.viewOf).toHaveBeenCalledWith("ws-1", "agent-1", "en")
    })

    it("seeds the graph of the installation on the first open", async () => {
        const { service, seed } = await build({ state: null })

        await service.open(ACTOR, "agent-1", "vi")

        expect(seed.ensureFor).toHaveBeenCalledWith("inst-1", "vi")
    })

    it("seeds nothing for an agent that has no installation", async () => {
        const { service, seed } = await build({ state: null, installed: false })

        await service.open(ACTOR, "agent-1", "vi")

        expect(seed.ensureFor).not.toHaveBeenCalled()
    })
})

describe("AgentGraphAdminService.versions", () => {
    it("lists the versions, newest first, as the store answers them", async () => {
        const { service, graphs } = await build()

        await expect(service.versions(ACTOR, "agent-1")).resolves.toEqual([VERSION])
        expect(graphs.versionsOf).toHaveBeenCalledWith("ws-1", "agent-1")
    })
})

describe("AgentGraphAdminService the run and the coverage", () => {
    it("answers no run trace: no engine gate walks a graph, so no graph decision exists (not found)", async () => {
        const { service } = await build()

        await expect(service.run(ACTOR, "item-9")).rejects.toMatchObject({ code: AgentGraphsErrorCode.RunNotFound })
    })

    it("answers no coverage to an owner or a manager: approver grants are gone with the authority rules", async () => {
        const { service } = await build()
        const none = await build({ state: null })

        await expect(service.coverage(ACTOR, "agent-1")).resolves.toEqual([])
        await expect(none.service.coverage(ACTOR, "agent-1")).resolves.toEqual([])
    })
})
