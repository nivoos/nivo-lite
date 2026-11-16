import { Test } from "@nestjs/testing"
import { SCOPE } from "@tests/fixtures/builders/agent-graph-records.builder"
import { MemoryTables, memoryGraphStore } from "@tests/fixtures/builders/engine-core-tables.builder"
import { AgentGraphRecordsService } from "./agent-graph-records.service"
import { AGENT_GRAPH_STORE } from "./agent-graph-store.port"
import type { GraphInsert, VersionInsert } from "./agent-graphs-records.contracts"

/** A clock of the table double: each write a minute after the one before, so "newest first" is told by the stamp. */
const ticking = (): (() => string) => {
    let minute = 0
    return () => {
        minute += 1
        return new Date(Date.UTC(2026, 10, 1, 1, minute)).toISOString()
    }
}

const build = async () => {
    const tables = new MemoryTables(ticking())
    const moduleRef = await Test.createTestingModule({
        providers: [AgentGraphRecordsService, { provide: AGENT_GRAPH_STORE, useValue: memoryGraphStore(tables) }],
    }).compile()
    return { service: moduleRef.get(AgentGraphRecordsService), tables }
}

const GRAPH = (agentId: string, installationId = `inst-${agentId}`): GraphInsert => ({
    agentId,
    installationId,
    draft: { nodes: [] },
    draftRev: 1,
    mode: "enforced",
})

const VERSION = (number: number, agentId = "agent-1"): VersionInsert => ({
    agentId,
    number,
    document: { nodes: [] },
    documentHash: "hash",
    contextVersionId: null,
    changeKind: "edit",
    note: "",
    publishedBy: null,
})

describe("AgentGraphRecordsService graphs", () => {
    it("reads the graph of an agent, or of an installation", async () => {
        const { service } = await build()
        await service.ensureGraph(SCOPE, GRAPH("agent-1", "inst-1"))

        await expect(service.graphOf(SCOPE, "agent-1")).resolves.toMatchObject({ agentId: "agent-1", fence: "1" })
        await expect(service.graphOfInstallation(SCOPE, "inst-1")).resolves.toMatchObject({ agentId: "agent-1" })
    })

    it("answers nothing for an agent or installation with no graph", async () => {
        const { service } = await build()
        await expect(service.graphOf(SCOPE, "agent-9")).resolves.toBeNull()
        await expect(service.graphOfInstallation(SCOPE, "inst-9")).resolves.toBeNull()
    })

    it("names which of some agents hold a graph, ordered by agent", async () => {
        const { service } = await build()
        await service.ensureGraph(SCOPE, GRAPH("agent-2"))
        await service.ensureGraph(SCOPE, GRAPH("agent-1"))

        await expect(service.agentsWithGraph(SCOPE, ["agent-2", "agent-1", "agent-3"])).resolves.toEqual(["agent-1", "agent-2"])
    })
})

describe("AgentGraphRecordsService graph writes", () => {
    it("finds or makes the graph of its agent, and says whether it made it", async () => {
        const { service } = await build()
        await expect(service.ensureGraph(SCOPE, GRAPH("agent-1"))).resolves.toMatchObject({ created: true })
        await expect(service.ensureGraph(SCOPE, GRAPH("agent-1"))).resolves.toMatchObject({
            created: false,
            graph: { agentId: "agent-1" },
        })
    })

    it("writes a graph under the version the caller read, and answers null when it moved on", async () => {
        const { service } = await build()
        const { graph } = await service.ensureGraph(SCOPE, GRAPH("agent-1"))

        await expect(service.patchGraph(SCOPE, graph, { mode: "shadow" })).resolves.toMatchObject({ mode: "shadow", fence: "2" })
        await expect(service.patchGraph(SCOPE, graph, { mode: "enforced" })).resolves.toBeNull()
    })
})

describe("AgentGraphRecordsService versions", () => {
    it("reads a version by id, or null", async () => {
        const { service } = await build()
        const version = await service.insertVersion(SCOPE, VERSION(1))

        await expect(service.version(SCOPE, version?.id ?? "")).resolves.toMatchObject({ number: 1, changeKind: "edit" })
        await expect(service.version(SCOPE, "version-9")).resolves.toBeNull()
    })

    it("lists the versions of an agent newest first", async () => {
        const { service } = await build()
        await service.insertVersion(SCOPE, VERSION(1))
        await service.insertVersion(SCOPE, VERSION(2))
        await service.insertVersion(SCOPE, VERSION(1, "agent-2"))

        const versions = await service.versionsOf(SCOPE, "agent-1", 10)
        expect(versions.map((version) => version.number)).toEqual([2, 1])
        await expect(service.latestVersion(SCOPE, "agent-1")).resolves.toMatchObject({ number: 2 })
    })

    it("answers no latest version for an agent with none", async () => {
        const { service } = await build()
        await expect(service.latestVersion(SCOPE, "agent-1")).resolves.toBeNull()
    })

    it("inserts a version, and answers null when its number is already the agent's", async () => {
        const { service } = await build()
        await expect(service.insertVersion(SCOPE, VERSION(1))).resolves.toMatchObject({ number: 1 })
        await expect(service.insertVersion(SCOPE, VERSION(1))).resolves.toBeNull()
    })
})
