import { mock } from "@starci/jest-preset"
import { SET_NAMES, envelopeOf } from "@tests/fixtures/builders/set-profiles.builder"
import type { BrainPolicyStoreService } from "@modules/domain/brain"
import type { BrainFactsService, FactInput, FactRecord } from "@modules/domain/brain-facts"
import type { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import type { ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import type { AgentAccountsService, TemplateProposal } from "@modules/domain/tools"
import type { ProfileSourcesService } from "@modules/domain/knowledge-sources"
import type { WorkspaceEnterpriseService, WorkspaceLobbyService, WorkspacesService } from "@modules/domain/workspaces"
import type { GraphSeedEntry, GraphSeedService } from "./graph-seed.service"
import type { RosterSeedService } from "./roster-seed.service"
import { WorkspaceSeedError } from "./errors/workspace-seed.error"
import { connectionIdOf, expandSetProfile, readSetProfile, standingOf } from "./set-seed.policy"
import { SetSeedService } from "./set-seed.service"
import type { WorkspaceSeedOptions } from "./workspace-seed.options"

/**
 * The set seed against IN-MEMORY stores: the doors it composes (workspaces, connections, the truth graph, the judgement store, the graph
 * seed) are held by maps, so what a profile says is what it creates and a second run creates nothing. The classes behind the doors are
 * stubbed at the import (this lane's `dist` of the packages is mid-conversion: nothing here needs the real installation).
 */
jest.mock("@modules/domain/installed-plugins", () => ({
    INSTALLED: { templateAgentOf: (key: string) => ({ key, accounts: [] }), plugins: [], templateAgents: () => [], templatesOf: () => [] },
    customerChannelProviders: () => new Set(["zalo_oa", "telegram", "meta"]),
    inboundChannelsOf: () => new Set(),
}))
jest.mock("./primary-graph.policy", () => ({ primaryGraphOf: (moduleKey: string) => ({ moduleKey }) }))
jest.mock("./graph-seed.service", () => ({ GraphSeedService: class {} }))
jest.mock("./roster-seed.service", () => ({ RosterSeedService: class {} }))
jest.mock("@modules/domain/brain", () => ({ BrainPolicyStoreService: class {} }))
jest.mock("@modules/domain/tools", () => ({ AgentAccountsService: class {} }))
jest.mock("@modules/domain/workspaces", () => ({ WorkspacesService: class {}, WorkspaceLobbyService: class {}, WorkspaceEnterpriseService: class {} }))
jest.mock("@modules/domain/knowledge-sources", () => ({ ProfileSourcesService: class {} }))
jest.mock("@modules/domain/connection-secrets", () => ({ ConnectionApiTokenService: class {}, randomSecret: () => "random-hook" }))
jest.mock("@modules/domain/connections", () => ({
    ConnectionsService: class {},
    isProvider: (value: string) => ["zalo_oa", "telegram", "meta", "sepay", "casso", "imap", "smtp", "inet", "tino", "misa_meinvoice"].includes(value),
}))
jest.mock("@modules/domain/brain-facts", () => ({
    BrainFactsService: class {},
    ...jest.requireActual("@modules/domain/brain-facts/fact-key.policy"),
    valueLineOf: jest.requireActual("@modules/domain/brain-facts/fact-input.policy").valueLineOf,
}))

const TODAY = new Date("2026-11-14T08:00:00.000Z")
const OWNER = "owner-1"
const NIVO = "ws-nivo"
/** The provider kinds each module's template lists, as the module's proposal reads them. */
const KINDS: Readonly<Record<string, ReadonlyArray<string>>> = { chatbot: ["zalo_oa", "telegram", "meta"], sales: ["sepay", "zalo_oa", "telegram", "meta"] }

/** One in-memory world of the doors the set seed composes. */
const worldOf = () => {
    const printed: Array<string> = []
    const workspaces = new Map<string, { readonly id: string; readonly name: string; live: boolean }>([[NIVO, { id: NIVO, name: "NIVO", live: true }]])
    const connections = new Map<string, ConnectionRecord>()
    const facts = new Map<string, FactRecord>()
    const judgements: Array<{ readonly subjectKey: string; readonly attribute: string; readonly installationId: string | null; readonly policy: boolean; readonly title: string }> = []
    const seeded = new Set<string>()
    const log = { proposed: 0, applied: 0, announced: 0, created: 0, removed: [] as Array<string>, attached: [] as Array<string>, bound: 0 }

    const workspaceService = mock<WorkspacesService>()
    workspaceService.list.mockImplementation(() => Promise.resolve([...workspaces.values()].map(({ id, name }) => ({ id, name })) as never))
    workspaceService.ownerIdOf.mockResolvedValue(OWNER)
    workspaceService.isLive.mockImplementation((id: string) => Promise.resolve(workspaces.get(id)?.live === true))
    workspaceService.ensureNamed.mockImplementation((_owner: string, name: string) => {
        const found = [...workspaces.values()].find((one) => one.name === name && one.live)
        if (found !== undefined) return Promise.resolve({ id: found.id })
        const id = `ws-${name}-${String(workspaces.size)}`
        workspaces.set(id, { id, name, live: true })
        log.created += 1
        return Promise.resolve({ id })
    })
    const lobby = mock<WorkspaceLobbyService>()
    lobby.remove.mockImplementation((_owner: string, id: string) => {
        const one = workspaces.get(id)
        if (one !== undefined) one.live = false
        log.removed.push(id)
        return Promise.resolve()
    })

    const connectionService = mock<ConnectionsService>()
    connectionService.list.mockImplementation((workspaceId: string) => Promise.resolve([...connections.values()].filter((one) => one.workspaceId === workspaceId)))
    connectionService.create.mockImplementation((input) => {
        const id = input.id ?? `c-${String(connections.size)}`
        connections.set(id, { id, workspaceId: input.workspaceId, provider: input.provider, name: input.name, meta: input.meta, sandbox: input.sandbox === true, status: "connected" } as unknown as ConnectionRecord)
        return Promise.resolve(id)
    })

    const abilities = mock<AgentAccountsService>()
    abilities.templateProposal.mockImplementation((workspaceId: string, moduleKey: string) =>
        Promise.resolve(
            (KINDS[moduleKey] ?? []).flatMap((kind): ReadonlyArray<TemplateProposal> => {
                const held = [...connections.values()].filter((one) => one.workspaceId === workspaceId && one.provider === kind)
                return held.length === 0
                    ? [{ provider: kind, connectionId: null, accountLabel: null, connected: false }]
                    : held.map((one) => ({ provider: kind, connectionId: one.id, accountLabel: one.name, connected: true }))
            }),
        ),
    )
    const graphs = mock<GraphSeedService>()
    graphs.seedInto.mockImplementation((_workspace: string, entries: ReadonlyArray<GraphSeedEntry>) => {
        for (const entry of entries) log.attached.push(`${entry.spec.moduleKey}:${String((entry.wishes ?? []).length)}`)
        const out = entries.map((entry) => ({ moduleKey: entry.spec.moduleKey, agentId: `agent-${entry.spec.moduleKey}`, changed: !seeded.has(entry.spec.moduleKey) }))
        for (const entry of entries) seeded.add(entry.spec.moduleKey)
        return Promise.resolve(out)
    })
    const roster = mock<RosterSeedService>()
    roster.bindFrontDoors.mockImplementation(() => {
        log.bound += 1
        return Promise.resolve(log.bound === 1 ? 2 : 0)
    })

    const factsService = mock<BrainFactsService>()
    factsService.list.mockImplementation((_workspace: string, filter: { readonly subjectKey?: string }) =>
        Promise.resolve([...facts.values()].filter((one) => filter.subjectKey === undefined || one.subjectKey === filter.subjectKey)),
    )
    factsService.propose.mockImplementation((_workspace: string, input: FactInput) => {
        const fold = (text: string): string => text.toLowerCase().replaceAll("đ", "d").normalize("NFD").replaceAll(/\p{Diacritic}/gu, "").replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "")
        const record = {
            id: `f-${String(facts.size + 1)}`,
            subjectType: input.subjectType ?? "business",
            subjectKey: fold(input.subjectLabel),
            subjectLabel: input.subjectLabel,
            attribute: fold(input.attributeLabel),
            attributeLabel: input.attributeLabel,
            value: input.value,
            unit: input.unit ?? null,
            scope: input.scope ?? "public",
            sourceKind: input.sourceKind,
            validFrom: input.validFrom ?? null,
            validTo: input.validTo ?? null,
            installationId: null,
            status: "proposed",
            proposalKind: "set",
            evidence: input.evidence ?? [],
        } as unknown as FactRecord
        facts.set(record.id, record)
        log.proposed += 1
        return Promise.resolve({ fact: record, outcome: "proposed" as const })
    })
    factsService.applyUnannounced.mockImplementation((_workspace: string, id: string) => {
        const one = facts.get(id) as FactRecord & { status: string }
        const ended = one.validTo !== null && one.validTo <= TODAY.toISOString().slice(0, 10)
        const later = one.validFrom !== null && one.validFrom > TODAY.toISOString().slice(0, 10)
        const done = { ...one, status: ended ? "expired" : later ? "scheduled" : "active" } as FactRecord
        facts.set(id, done)
        log.applied += 1
        return Promise.resolve(done)
    })
    factsService.announceChanged.mockImplementation((_workspace: string, ids: ReadonlyArray<string>) => {
        log.announced += ids.length
        return Promise.resolve()
    })
    const store = mock<BrainPolicyStoreService>()
    store.all.mockImplementation(() => Promise.resolve(judgements as never))
    store.save.mockImplementation((_workspace: string, judged) => {
        for (const one of judged) {
            judgements.push({ subjectKey: one.fact.subjectKey, attribute: one.fact.attribute, installationId: one.fact.installationId, policy: one.judgement.policy, title: one.judgement.title })
        }
        return Promise.resolve(judged.length)
    })

    const options = { print: (line: string) => printed.push(line) } as unknown as WorkspaceSeedOptions
    const enterprise = mock<WorkspaceEnterpriseService>()
    const sources = mock<ProfileSourcesService>()
    const service = new SetSeedService(options, { now: () => TODAY }, workspaceService, lobby, connectionService, abilities, graphs, roster, factsService, store, enterprise, sources, mock<ConnectionApiTokenService>())
    return { service, printed, workspaces, connections, facts, judgements, log, workspaceService, lobby, connectionService, graphs, factsService, store }
}

const run = { dry: false, bind: false }
const WORKSPACE_SETS = SET_NAMES.filter((name) => name !== "set-agency")

describe("SetSeedService.run: what a profile says is what it creates", () => {
    it.each(WORKSPACE_SETS)("%s: the workspace, its accounts under derived ids, its agents, every truth and the judgement of each held one", async (name) => {
        const { service, workspaces, connections, facts, judgements, log, printed } = worldOf()
        const profile = readSetProfile(envelopeOf(name))
        const plan = expandSetProfile(profile)
        const standing = plan.facts.map((fact) => standingOf(fact, "2026-11-14"))

        await service.run(envelopeOf(name), "dev", run)

        const workspaceId = [...workspaces.values()].find((one) => one.name === profile.workspaceName)?.id ?? ""
        expect(workspaceId).not.toBe("")
        expect([...connections.keys()].toSorted()).toEqual(profile.accounts.map((account) => connectionIdOf(workspaceId, account.key)).toSorted())
        expect([...connections.values()].every((one) => one.sandbox)).toBe(true)
        expect(log.attached).toEqual(profile.agents.length === 0 ? [] : [`chatbot:${String(wishesOf(profile, "chatbot"))}`, `sales:${String(wishesOf(profile, "sales"))}`])
        expect(facts.size).toBe(plan.facts.length)
        expect(log.applied).toBe(standing.filter((one) => one !== "waiting").length)
        const held = plan.facts.filter((_, index) => standing[index] === "in_force" || standing[index] === "scheduled")
        const keys = new Set(held.map((fact) => `${fact.subject}|${fact.attribute}`))
        expect(judgements).toHaveLength(keys.size)
        expect(judgements.filter((one) => one.policy)).toHaveLength(new Set(held.filter((fact) => fact.policy !== null).map((fact) => `${fact.subject}|${fact.attribute}`)).size)
        expect(printed.at(-1)).toBe("applied")
    })

    it("judges a truth with no policy mark as not a policy and a marked one with its title, model-free", async () => {
        const { service, judgements } = worldOf()

        await service.run(envelopeOf("set-small-shop"), "dev", run)

        expect(judgements.filter((one) => one.policy).map((one) => one.title).toSorted()).toEqual([
            "Mức giảm giá tối đa cho khách quen",
            "Phí giao hàng nội thành",
            "Thời hạn báo hoa lỗi để được làm lại hoặc hoàn tiền",
        ])
        expect(judgements.filter((one) => !one.policy)).toHaveLength(17)
    })

    it("files the waiting value beside the value in force, expires the ended window and schedules the later one (the conflicting set)", async () => {
        const { service, facts } = worldOf()

        await service.run(envelopeOf("set-conflicting"), "dev", run)

        const states = (attribute: string): ReadonlyArray<string> => [...facts.values()].filter((one) => one.attributeLabel === attribute).map((one) => `${one.value}:${one.status}`)
        expect(states("Mức giảm tối đa")).toEqual(["10%:active", "15%:proposed"])
        expect(states("Phí giao nội thành")).toEqual(["30.000 đ:active", "40.000 đ:scheduled"])
        expect(states("Khuyến mãi 8/3")).toEqual(["giảm 20% mọi bó hoa:expired"])
        expect(states("Phụ thu dịp Tết")).toEqual(["15%:scheduled"])
    })

    it("writes the large set in the thousands, forty policies among them, with one announcement", async () => {
        const { service, facts, judgements, factsService } = worldOf()

        await service.run(envelopeOf("set-large"), "dev", run)

        expect(facts.size).toBeGreaterThan(2000)
        expect(judgements.filter((one) => one.policy)).toHaveLength(40)
        expect(factsService.announceChanged).toHaveBeenCalledTimes(1)
    })
})

/** How many accounts a module's template kinds make of the profile's accounts (the attach rule takes every sandbox account of a kind). */
const wishesOf = (profile: ReturnType<typeof readSetProfile>, moduleKey: string): number =>
    profile.accounts.filter((account) => (KINDS[moduleKey] ?? []).includes(account.provider)).length

describe("SetSeedService.run: IDEMPOTENT, and the choices that change what it writes", () => {
    it.each(WORKSPACE_SETS)("%s: a second run creates, proposes, applies, judges and announces nothing and says unchanged", async (name) => {
        const world = worldOf()
        await world.service.run(envelopeOf(name), "dev", run)
        const before = { ...world.log, created: world.log.created, judgements: world.judgements.length, facts: world.facts.size, connections: world.connections.size }
        world.printed.length = 0

        await world.service.run(envelopeOf(name), "dev", run)

        expect({ ...world.log, judgements: world.judgements.length, facts: world.facts.size, connections: world.connections.size, attached: [], bound: 0 }).toEqual({ ...before, attached: [], bound: 0 })
        expect(world.printed.at(-1)).toBe("unchanged")
    })

    it("writes nothing on a dry run and prints the plan", async () => {
        const world = worldOf()

        await world.service.run(envelopeOf("set-small-shop"), "dev", { dry: true, bind: false })

        expect(world.connectionService.create).not.toHaveBeenCalled()
        expect(world.workspaceService.ensureNamed).not.toHaveBeenCalled()
        expect(world.factsService.propose).not.toHaveBeenCalled()
        expect(world.printed[0]).toContain("20 truths")
        expect(world.printed.at(-1)).toContain("dry run: nothing written")
    })

    it("binds the customer channels only with --bind, once", async () => {
        const world = worldOf()
        await world.service.run(envelopeOf("set-multichannel"), "dev", run)
        expect(world.log.bound).toBe(0)

        await world.service.run(envelopeOf("set-multichannel"), "dev", { dry: false, bind: true })

        expect(world.log.bound).toBe(1)
        expect(world.printed.at(-1)).toBe("applied")
    })

    it("refuses any environment but the local stack, by the field's name, before reading anything", async () => {
        const world = worldOf()

        await expect(world.service.run(envelopeOf("set-empty"), "production", run)).rejects.toBeInstanceOf(WorkspaceSeedError)
        await expect(world.service.doors(envelopeOf("set-empty"), "production")).rejects.toBeInstanceOf(WorkspaceSeedError)
        await expect(world.service.reset(envelopeOf("set-empty"), "production", true)).rejects.toBeInstanceOf(WorkspaceSeedError)
        expect(world.workspaceService.list).not.toHaveBeenCalled()
    })
})

describe("the overlay set (the agency)", () => {
    it("opens its sandbox accounts in the existing workspace, installs no agent and attaches nothing", async () => {
        const world = worldOf()
        world.workspaces.set("ws-web", { id: "ws-web", name: "NIVO Web", live: true })

        await world.service.run(envelopeOf("set-agency"), "dev", run)

        expect(world.log.created).toBe(0)
        expect(world.connections.size).toBe(9)
        expect(world.graphs.seedInto).not.toHaveBeenCalled()
        expect(world.facts.size).toBe(0)
        await world.service.run(envelopeOf("set-agency"), "dev", run)
        expect(world.connections.size).toBe(9)
        expect(world.printed.at(-1)).toBe("unchanged")
    })

    it("is refused when the workspace it overlays does not exist, and its reset never removes the workspace", async () => {
        const world = worldOf()

        await expect(world.service.run(envelopeOf("set-agency"), "dev", run)).rejects.toBeInstanceOf(WorkspaceSeedError)
        world.workspaces.set("ws-web", { id: "ws-web", name: "NIVO Web", live: true })
        await world.service.reset(envelopeOf("set-agency"), "dev", true)
        expect(world.lobby.remove).not.toHaveBeenCalled()
        expect(world.printed.at(-1)).toContain("never removed")
    })
})

describe("SetSeedService.reset", () => {
    it("prints the plan and removes nothing without --execute; with it removes the one workspace through the owner's door, then finds nothing", async () => {
        const world = worldOf()
        await world.service.run(envelopeOf("set-empty"), "dev", run)

        await world.service.reset(envelopeOf("set-empty"), "dev", false)
        expect(world.lobby.remove).not.toHaveBeenCalled()
        expect(world.printed.at(-1)).toContain("dry run: nothing removed")

        await world.service.reset(envelopeOf("set-empty"), "dev", true)
        expect(world.lobby.remove).toHaveBeenCalledTimes(1)
        expect(world.lobby.remove.mock.calls[0]?.[0]).toBe(OWNER)
        expect(world.lobby.remove.mock.calls[0]?.[2]).toBe("set-empty")

        await world.service.reset(envelopeOf("set-empty"), "dev", true)
        expect(world.lobby.remove).toHaveBeenCalledTimes(1)
        expect(world.printed.at(-1)).toContain("nothing to remove")
    })

    it("lets a set be made again after a reset: a new workspace, accounts under new ids", async () => {
        const world = worldOf()
        await world.service.run(envelopeOf("set-empty"), "dev", run)
        const first = [...world.connections.keys()]
        await world.service.reset(envelopeOf("set-empty"), "dev", true)

        await world.service.run(envelopeOf("set-empty"), "dev", run)

        expect(world.log.created).toBe(2)
        expect([...world.connections.keys()].filter((id) => !first.includes(id))).toHaveLength(2)
    })
})

describe("SetSeedService.doors", () => {
    it("prints the workspace, then a line per step with the provider's inbound case, the account's derived id and the node choices", async () => {
        const world = worldOf()
        await world.service.run(envelopeOf("set-multichannel"), "dev", run)
        world.printed.length = 0

        await world.service.doors(envelopeOf("set-multichannel"), "dev")

        const lines = world.printed.map((line) => JSON.parse(line) as Record<string, unknown>)
        const workspaceId = lines[0]?.workspaceId as string
        expect(lines[0]).toMatchObject({ kind: "workspace", set: "set-multichannel" })
        expect(lines[1]).toMatchObject({ kind: "line", connectionId: connectionIdOf(workspaceId, "zalo-a"), caseId: "ZALO-1" })
        expect(lines.filter((one) => one.kind === "line")).toHaveLength(6)
        expect(lines.find((one) => one.kind === "merge")?.people).toHaveLength(3)
        expect(lines.filter((one) => one.kind === "pull")).toEqual([{ kind: "pull", connectionId: connectionIdOf(workspaceId, "mail-a"), caseId: "IMAP-1" }])
        expect(lines.at(-1)).toEqual({
            kind: "node",
            module: "chatbot",
            workflow: "chatbot.front-desk",
            node: "answer",
            accounts: [connectionIdOf(workspaceId, "zalo-b"), connectionIdOf(workspaceId, "zalo-a")],
        })
    })

    it("is refused while the workspace does not exist", async () => {
        const world = worldOf()

        await expect(world.service.doors(envelopeOf("set-small-shop"), "dev")).rejects.toBeInstanceOf(WorkspaceSeedError)
    })
})
