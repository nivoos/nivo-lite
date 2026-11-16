import { mock } from "@starci/jest-preset"
import type { BrainPolicyStoreService } from "@modules/domain/brain"
import type { BrainFactsService, FactInput, FactRecord } from "@modules/domain/brain-facts"
import type { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import type { ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import type { ProfileSourcesService } from "@modules/domain/knowledge-sources"
import type { AgentAccountsService } from "@modules/domain/tools"
import type { WorkspaceEnterpriseService, WorkspaceLobbyService, WorkspacesService } from "@modules/domain/workspaces"
import { WorkspaceSeedError, WorkspaceSeedErrorCode } from "./errors/workspace-seed.error"
import type { GraphSeedService } from "./graph-seed.service"
import type { RosterSeedService } from "./roster-seed.service"
import type { SeedReceiptWrite, SeedReceiptsService } from "./seed-receipts.service"
import type { SeedStandardDriver } from "./seed-standard.port"
import { SEED_STANDARD_COMPLETENESS, SEED_STANDARD_SCHEMA, layoutProblemsOf, readSeedStandardRef, seedDecisionOf, type SeedReceipt } from "./seed-standard.policy"
import { SeedStandardService } from "./seed-standard.service"
import { attachEveryOf } from "./roster-seed.policy"
import { SET_SEED_SCHEMA, type SealedValues } from "./set-seed.contracts"
import { connectionIdOf } from "./set-seed.policy"
import { SetSeedService } from "./set-seed.service"
import type { WorkspaceSeedOptions } from "./workspace-seed.options"

/**
 * THE SEED STANDARDS against IN-MEMORY doors: the driver (a pinned repo), the receipts, the connections with their sealed secrets, the truth
 * graph, the knowledge door. Proves: loaded once, a new pin only reported, a declared force consumed once per commit, a forced re-seed that
 * keeps relations (same ids, operational rows untouched, a person's credential and truth kept), a missing / empty / unreadable secret stops
 * that account only, and no secret VALUE ever reaches the printed output or an error.
 */
jest.mock("@modules/domain/installed-plugins", () => ({
    INSTALLED: { templateAgentOf: () => null, plugins: [{ key: "core", visibility: "public", enterprises: [], modules: ["chatbot"] }], templatesOf: () => [] },
    inboundChannelsOf: () => new Set(),
}))
jest.mock("@modules/domain/channel-provisioning", () => ({
    placeOf: (environment: string) => ({ dev: "local", production: "prod" })[environment],
    targetIncludes: (target: string, place: string) => target === "both" || target === place,
}))
jest.mock("./primary-graph.policy", () => ({ primaryGraphOf: (moduleKey: string) => ({ moduleKey }) }))
jest.mock("./graph-seed.service", () => ({ GraphSeedService: class {} }))
jest.mock("./roster-seed.service", () => ({ RosterSeedService: class {} }))
jest.mock("./seed-receipts.service", () => ({ SeedReceiptsService: class {} }))
jest.mock("@modules/domain/brain", () => ({ BrainPolicyStoreService: class {} }))
jest.mock("@modules/domain/tools", () => ({ AgentAccountsService: class {} }))
jest.mock("@modules/domain/knowledge-sources", () => ({ ProfileSourcesService: class {} }))
jest.mock("@modules/domain/workspaces", () => ({ WorkspacesService: class {}, WorkspaceLobbyService: class {}, WorkspaceEnterpriseService: class {} }))
jest.mock("@modules/domain/connection-secrets", () => ({ ConnectionApiTokenService: class {}, randomSecret: () => "random-hook" }))
jest.mock("@modules/domain/connections", () => ({ ConnectionsService: class {}, isProvider: () => true }))
jest.mock("@modules/domain/brain-facts", () => ({
    BrainFactsService: class {},
    ...jest.requireActual("@modules/domain/brain-facts/fact-key.policy"),
    valueLineOf: jest.requireActual("@modules/domain/brain-facts/fact-input.policy").valueLineOf,
}))

const COMMIT_A = "a".repeat(40)
const COMMIT_B = "b".repeat(40)
const NAME = "shop-seed-standard"
/** What a standard derives its connection ids from: its own name, never the workspace (a wipe keeps them). */
const STANDARD = `standard:${"shop-seed-standard"}`
/** Secret values of the fake sealed file: the specs assert none of them is ever printed or thrown. */
const SECRET_ZALO = "zalo-secret-value-1"
const SECRET_BANK = "bank-secret-value-1"

const documentOf = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    schema: SET_SEED_SCHEMA,
    use: "workspace",
    name: NAME,
    target: "local",
    workspaceName: "Shop",
    ownerWorkspace: "NIVO",
    plugins: [{ key: "core", version: "0.1.0" }],
    agents: [],
    accounts: [
        { key: "zalo-main", provider: "zalo_oa", name: "Zalo chính", sandbox: false, secrets: ["credential"] },
        { key: "bank", provider: "sepay", name: "Ngân hàng", sandbox: false, secrets: ["credential", "webhookSecret", "apiToken", "fact.bank_code"] },
        { key: "mail", provider: "smtp", name: "Hộp thư", sandbox: false, secrets: ["credential"] },
        { key: "zalo-sbx", provider: "zalo_oa", name: "Sandbox Zalo" },
        { key: "tele", provider: "telegram", name: "Telegram", sandbox: false, secrets: ["credential"], connectionId: "72f2699d-7f93-45e1-964a-8e7337985000" },
    ],
    documents: [{ path: "knowledge/gia.md", title: "Bảng giá", topic: "Giá", visibility: "public" }],
    truths: [
        { type: "policy", subject: "Giao hàng", attribute: "Phí giao", value: "30.000 đ", policy: { title: "Phí giao", group: "Giao hàng" } },
        { type: "product", subject: "Bó hồng", attribute: "Giá", value: "350.000 đ" },
    ],
    ...overrides,
})

const SEALED: SealedValues = {
    opened: true,
    accounts: { tele: { credential: "tele-value-1" }, "zalo-main": { credential: SECRET_ZALO }, bank: { credential: SECRET_BANK, webhookSecret: "hook-1", apiToken: "bank-token-value-1", "fact.bank_code": "VCB" }, mail: { credential: "" } },
}

const declaration = (commit: string, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ documents: [{ path: `seed-standards/${NAME}.json`, document: { schema: SEED_STANDARD_SCHEMA, name: NAME, repository: "D:/Repositories/x", commit, completeness: SEED_STANDARD_COMPLETENESS, ...extra } }] })

/** One in-memory world. `files` is the repo at its pinned commit; `operational` are rows made by running the workspace (never the seed's). */
const worldOf = () => {
    const printed: Array<string> = []
    const files = new Map<string, string>([["seed.json", JSON.stringify(documentOf())], ["knowledge/gia.md", "# Bảng giá"]])
    let sealed: SealedValues = SEALED
    const workspaces = new Map<string, { readonly id: string; readonly name: string }>([["ws-nivo", { id: "ws-nivo", name: "NIVO" }]])
    const connections = new Map<string, ConnectionRecord & { meta: Record<string, string> }>()
    const secrets = new Map<string, { plain: string; webhookSecret: string; sealedAt: string }>()
    const facts = new Map<string, FactRecord>()
    const receipts = new Map<string, SeedReceipt>()
    const operational = { contacts: [] as Array<{ id: string; connectionId: string }>, routes: [] as Array<{ id: string; connectionId: string }> }
    let clock = "2026-11-14T08:00:00.000Z"

    const workspaceService = mock<WorkspacesService>()
    workspaceService.list.mockImplementation(() => Promise.resolve([...workspaces.values()] as never))
    workspaceService.ownerIdOf.mockResolvedValue("owner-1")
    workspaceService.isLive.mockResolvedValue(true)
    workspaceService.ensureNamed.mockImplementation((_owner: string, name: string) => {
        const found = [...workspaces.values()].find((one) => one.name === name)
        if (found !== undefined) return Promise.resolve({ id: found.id })
        workspaces.set(`ws-${name}`, { id: `ws-${name}`, name })
        return Promise.resolve({ id: `ws-${name}` })
    })
    const connectionService = mock<ConnectionsService>()
    connectionService.list.mockImplementation((workspaceId: string) => Promise.resolve([...connections.values()].filter((one) => one.workspaceId === workspaceId)))
    connectionService.create.mockImplementation((input) => {
        const id = input.id ?? "x"
        connections.set(id, { id, workspaceId: input.workspaceId, provider: input.provider, name: input.name, meta: { ...input.meta }, sandbox: input.sandbox === true } as never)
        if (input.sandbox !== true) secrets.set(id, { plain: input.secret.plain, webhookSecret: input.secret.webhookSecret, sealedAt: clock })
        return Promise.resolve(id)
    })
    connectionService.patch.mockImplementation((_workspace: string, id: string, patch) => {
        const one = connections.get(id)
        if (one !== undefined) connections.set(id, { ...one, name: patch.name ?? one.name, meta: { ...(patch.meta ?? one.meta) } })
        return Promise.resolve()
    })
    connectionService.readSecret.mockImplementation((id: string) => Promise.resolve(secrets.get(id) ?? null))
    connectionService.writeSecret.mockImplementation((id: string, plain: string, webhookSecret?: string) => {
        secrets.set(id, { plain, webhookSecret: webhookSecret ?? secrets.get(id)?.webhookSecret ?? "", sealedAt: clock })
        return Promise.resolve()
    })
    const factsService = mock<BrainFactsService>()
    factsService.list.mockImplementation((_workspace: string, filter: { readonly subjectKey?: string; readonly statuses?: ReadonlyArray<string> }) =>
        Promise.resolve([...facts.values()].filter((one) => (filter.subjectKey === undefined || one.subjectKey === filter.subjectKey) && (filter.statuses === undefined || filter.statuses.includes(one.status)))),
    )
    const fold = (text: string): string => text.toLowerCase().replaceAll("đ", "d").normalize("NFD").replaceAll(/\p{Diacritic}/gu, "").replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/^-|-$/gu, "")
    const propose = (input: FactInput, by: string): FactRecord => {
        const record = { id: `f-${String(facts.size + 1)}`, subjectType: input.subjectType ?? "business", subjectKey: fold(input.subjectLabel), subjectLabel: input.subjectLabel, attribute: fold(input.attributeLabel), attributeLabel: input.attributeLabel, value: input.value, unit: input.unit ?? null, installationId: null, status: "proposed", proposedBy: by } as unknown as FactRecord
        facts.set(record.id, record)
        return record
    }
    factsService.propose.mockImplementation((_workspace: string, input: FactInput) => Promise.resolve({ fact: propose(input, input.proposedBy ?? "x"), outcome: "proposed" as const }))
    factsService.applyUnannounced.mockImplementation((_workspace: string, id: string) => {
        const done = { ...(facts.get(id) as FactRecord), status: "active" } as FactRecord
        for (const other of facts.values()) if (other.id !== id && other.status === "active" && other.subjectKey === done.subjectKey && other.attribute === done.attribute) facts.set(other.id, { ...other, status: "superseded" } as FactRecord)
        facts.set(id, done)
        return Promise.resolve(done)
    })
    factsService.announceChanged.mockResolvedValue()
    const store = mock<BrainPolicyStoreService>()
    store.all.mockResolvedValue([])
    store.save.mockResolvedValue(0)
    const graphs = mock<GraphSeedService>()
    graphs.seedInto.mockResolvedValue([])
    const tokens = new Map<string, string>()
    const apiTokens = mock<ConnectionApiTokenService>()
    apiTokens.read.mockImplementation((id: string) => Promise.resolve(tokens.get(id) ?? null))
    apiTokens.write.mockImplementation((id: string, token: string) => {
        tokens.set(id, token)
        return Promise.resolve(true)
    })
    const sources = mock<ProfileSourcesService>()
    const kept = new Map<string, string>()
    sources.keep.mockImplementation((input) => {
        const before = kept.get(input.title)
        kept.set(input.title, input.content)
        return Promise.resolve(before === undefined ? "inserted" : before === input.content ? "unchanged" : "requeued")
    })
    const receiptsService = mock<SeedReceiptsService>()
    receiptsService.find.mockImplementation((name: string, environment: string) => Promise.resolve(receipts.get(`${name}|${environment}`) ?? null))
    receiptsService.record.mockImplementation((receipt: SeedReceiptWrite) => {
        receipts.set(`${receipt.name}|${receipt.environment}`, { name: receipt.name, environment: receipt.environment, workspaceId: receipt.workspaceId, commit: receipt.commit, forcedCommit: receipt.forcedCommit, appliedAt: clock, doors: receipts.get(`${receipt.name}|${receipt.environment}`)?.doors ?? [] })
        return Promise.resolve()
    })
    receiptsService.recordDoors.mockImplementation((name: string, environment: string, doors) => {
        const held = receipts.get(`${name}|${environment}`)
        if (held === undefined) return Promise.resolve(false)
        receipts.set(`${name}|${environment}`, { ...held, doors })
        return Promise.resolve(true)
    })
    receiptsService.remove.mockImplementation((name: string, environment: string) => {
        receipts.delete(`${name}|${environment}`)
        return Promise.resolve()
    })
    const opened: Array<string> = []
    const driver: SeedStandardDriver = {
        checkout: jest.fn(() =>
            Promise.resolve({
                readText: (path: string) => Promise.resolve(files.get(path) ?? null),
                sealedOf: (path: string) => {
                    opened.push(path)
                    return Promise.resolve(sealed)
                },
            }),
        ),
    }
    const options = { print: (line: string) => printed.push(line) } as unknown as WorkspaceSeedOptions
    const applier = new SetSeedService(options, { now: () => new Date(clock) }, workspaceService, mock<WorkspaceLobbyService>(), connectionService, mock<AgentAccountsService>(), graphs, mock<RosterSeedService>(), factsService, store, mock<WorkspaceEnterpriseService>(), sources, apiTokens)
    const service = new SeedStandardService(options, applier, receiptsService, driver)
    return {
        service, printed, files, opened, tokens, connections, secrets, facts, receipts, operational, driver, propose, connectionService, factsService,
        setSealed: (next: SealedValues) => {
            sealed = next
        },
        tick: (at: string) => {
            clock = at
        },
    }
}

describe("readSeedStandardRef and seedDecisionOf", () => {
    const ref = readSeedStandardRef({ schema: SEED_STANDARD_SCHEMA, name: NAME, repository: "r", commit: COMMIT_A, completeness: SEED_STANDARD_COMPLETENESS })
    const receipt: SeedReceipt = { name: NAME, environment: "dev", workspaceId: "w", commit: COMMIT_A, forcedCommit: null, appliedAt: "2026-11-14T08:00:00.000Z", doors: [] }

    it("refuses a declaration without a pinned commit, a name that is no seed standard, a force kind outside the closed list or without force", () => {
        const field = (document: Record<string, unknown>): unknown => {
            try {
                readSeedStandardRef({ schema: SEED_STANDARD_SCHEMA, name: NAME, repository: "r", commit: COMMIT_A, completeness: SEED_STANDARD_COMPLETENESS, ...document })
            } catch (error) {
                return (error as WorkspaceSeedError).params?.field
            }
            return null
        }
        expect(field({ commit: undefined })).toBe("commit")
        expect(field({ commit: "main" })).toBe("commit")
        expect(field({ name: "shop-seed-backup" })).toBe("name")
        expect(field({ force: true, forceKinds: ["contacts"] })).toBe("forceKinds")
        expect(field({ forceKinds: ["credentials"] })).toBe("forceKinds")
        expect(field({ completeness: undefined })).toBe("completeness")
    })

    it("seeds without a receipt; skips whole with one; reports a new pin; a declared force re-seeds once per commit", () => {
        expect(seedDecisionOf(ref, null)).toEqual({ act: "seed" })
        expect(seedDecisionOf(ref, receipt)).toMatchObject({ act: "skip", why: `already seeded at ${COMMIT_A}; door steps: none recorded yet` })
        expect(seedDecisionOf({ ...ref, commit: COMMIT_B }, receipt)).toMatchObject({ act: "skip", why: expect.stringContaining("standard changed since it was seeded") })
        expect(seedDecisionOf({ ...ref, commit: COMMIT_B, force: true }, receipt)).toEqual({ act: "reseed", since: receipt.appliedAt })
        expect(seedDecisionOf({ ...ref, commit: COMMIT_B, force: true }, { ...receipt, commit: COMMIT_B, forcedCommit: COMMIT_B })).toMatchObject({ act: "skip" })
    })
})

describe("layoutProblemsOf: data plain, credentials only in the two sealed files of their place (R107)", () => {
    const plain = (path: string) => ({ path, sealed: false })
    const sealedFile = (path: string) => ({ path, sealed: true })

    it("accepts the document, plain knowledge and the two sealed credential files", () => {
        expect(layoutProblemsOf([plain("seed.json"), plain("knowledge/a.md"), sealedFile("secrets.dev.enc.yaml"), sealedFile("secrets.prod.enc.yaml")])).toEqual([])
    })

    it("refuses an encrypted data file, a single secrets.enc.yaml, a secrets folder and an unsealed credential file", () => {
        expect(layoutProblemsOf([plain("seed.json"), sealedFile("knowledge/a.md")])).toEqual([expect.stringContaining("knowledge/a.md: sealed")])
        expect(layoutProblemsOf([plain("seed.json"), sealedFile("secrets.enc.yaml")])).toEqual([expect.stringContaining("secrets.enc.yaml: sealed"), expect.stringContaining("credentials live only in")])
        expect(layoutProblemsOf([plain("seed.json"), sealedFile("secrets/dev.enc.yaml")])).toHaveLength(2)
        expect(layoutProblemsOf([plain("seed.json"), plain("secrets.dev.enc.yaml")])).toEqual(["secrets.dev.enc.yaml: not sealed"])
        expect(layoutProblemsOf([plain("knowledge/a.md")])).toEqual(["seed.json: missing"])
    })
})

describe("SeedStandardService.apply: loaded once by the bring-up", () => {
    it("opens the sealed file of the place it runs in, never the other place's", async () => {
        const world = worldOf()

        await world.service.apply(declaration(COMMIT_A), "dev", false)

        expect(world.opened).toEqual(["secrets.dev.enc.yaml"])
    })

    it("seeds the workspace, its accounts under stable ids, its documents and truths, and records the receipt", async () => {
        const world = worldOf()

        await world.service.apply(declaration(COMMIT_A), "dev", false)

        const workspaceId = "ws-Shop"
        expect([...world.connections.keys()].toSorted()).toEqual([connectionIdOf(STANDARD, "bank"), connectionIdOf(STANDARD, "zalo-main"), connectionIdOf(STANDARD, "zalo-sbx"), "72f2699d-7f93-45e1-964a-8e7337985000"].toSorted())
        expect(world.secrets.get(connectionIdOf(STANDARD, "zalo-main"))?.plain).toBe(SECRET_ZALO)
        expect(world.secrets.get(connectionIdOf(STANDARD, "zalo-main"))?.webhookSecret).toBe("random-hook")
        expect(world.tokens.get(connectionIdOf(STANDARD, "bank"))).toBe("bank-token-value-1")
        expect(world.connections.get(connectionIdOf(STANDARD, "bank"))?.meta).toEqual({ bank_code: "VCB" })
        expect(world.printed.join(" ")).not.toContain("bank-token-value-1")
        expect(world.receipts.get(`${NAME}|dev`)).toMatchObject({ commit: COMMIT_A, forcedCommit: null, workspaceId })
        expect(world.printed.at(-1)).toBe("applied")
    })

    it("stops the account whose secret member is empty, missing or unreadable with its typed reason and goes on", async () => {
        const world = worldOf()
        await world.service.apply(declaration(COMMIT_A), "dev", false)
        expect(world.printed.some((line) => line.includes("live account mail (smtp) not created: secret_empty (credential)"))).toBe(true)

        const other = worldOf()
        other.setSealed({ opened: false, reason: "no identity" })
        await other.service.apply(declaration(COMMIT_A), "dev", false)
        expect(other.printed.filter((line) => line.includes("not created: sealed_unreadable"))).toHaveLength(4)
        expect([...other.connections.values()].map((one) => one.provider)).toEqual(["zalo_oa"])

        const third = worldOf()
        third.setSealed({ opened: true, accounts: { "zalo-main": {}, bank: { credential: "x" }, mail: { credential: "y" } } })
        await third.service.apply(declaration(COMMIT_A), "dev", false)
        expect(third.printed.some((line) => line.includes("zalo-main (zalo_oa) not created: secret_missing (credential); sandbox twin zalo-sbx in use"))).toBe(true)
        expect(third.printed.some((line) => line.includes("bank (sepay) not created: secret_missing (webhookSecret)"))).toBe(true)
    })

    it("skips a seeded standard WHOLE on the next bring-up (no driver read), and only reports a new pin", async () => {
        const world = worldOf()
        await world.service.apply(declaration(COMMIT_A), "dev", false)
        world.printed.length = 0

        await world.service.apply(declaration(COMMIT_A), "dev", false)
        await world.service.apply(declaration(COMMIT_B), "dev", false)

        expect(world.driver.checkout).toHaveBeenCalledTimes(1)
        expect(world.printed).toEqual([
            `${NAME}: already seeded at ${COMMIT_A}; door steps: none recorded yet: nothing done`,
            "unchanged",
            `${NAME}: standard changed since it was seeded (${COMMIT_A} -> ${COMMIT_B}): declare force on its stack declaration to re-seed: nothing done`,
            "unchanged",
        ])
    })

    it("refuses with a typed reason when no data driver is bound (never a fallback)", async () => {
        const world = worldOf()
        const bare = new SeedStandardService({ print: () => undefined } as unknown as WorkspaceSeedOptions, {} as SetSeedService, { find: () => Promise.resolve(null) } as unknown as SeedReceiptsService)

        await expect(bare.apply(declaration(COMMIT_A), "dev", false)).rejects.toMatchObject({ code: WorkspaceSeedErrorCode.DriverMissing })
        expect(world.connections.size).toBe(0)
    })
})

describe("door steps are seed steps: a refused one is FAILED in the receipt, with its typed code (R109 finding 3)", () => {
    it("records the door script's report and every later bring-up shows the failed steps", async () => {
        const world = worldOf()
        await world.service.apply(declaration(COMMIT_A), "dev", false)
        world.printed.length = 0

        await world.service.recordDoors(
            JSON.stringify({ standards: { [NAME]: [{ step: "settings timeZone", outcome: "failed", code: "WORKSPACES_TIME_ZONE_INVALID" }, { step: "node chatbot.front-desk/answer", outcome: "done" }] } }),
            "dev",
        )
        await world.service.apply(declaration(COMMIT_A), "dev", false)

        expect(world.printed[0]).toBe(`${NAME}: door steps: 1 of 2 FAILED (settings timeZone: WORKSPACES_TIME_ZONE_INVALID)`)
        expect(world.printed[1]).toContain("door steps: 1 of 2 FAILED (settings timeZone: WORKSPACES_TIME_ZONE_INVALID)")
    })

    it("refuses a report that is not the closed shape, and names a standard with no receipt", async () => {
        const world = worldOf()

        await expect(world.service.recordDoors(JSON.stringify({ standards: { [NAME]: [{ step: "x", outcome: "maybe" }] } }), "dev")).rejects.toMatchObject({ code: WorkspaceSeedErrorCode.InputInvalid })
        await world.service.recordDoors(JSON.stringify({ standards: { [NAME]: [] } }), "dev")
        expect(world.printed.at(-1)).toContain("no receipt in this environment")
    })
})

describe("attachEveryOf: a standard attaches every working account it names (R109 finding 2)", () => {
    const lines = [
        { provider: "zalo_oa", connectionId: "live-zalo", accountLabel: "Zalo", connected: true },
        { provider: "zalo_oa", connectionId: "sbx-zalo", accountLabel: "Sandbox Zalo", connected: true },
        { provider: "sepay", connectionId: null, accountLabel: null, connected: false },
    ]
    const isSandbox = (id: string): boolean => id.startsWith("sbx")

    it("attaches live AND sandbox accounts on the local stack (a node setting may name the sandbox one), only live ones in production", () => {
        expect(attachEveryOf(lines, isSandbox, "local")).toEqual({ wishes: [{ connectionId: "live-zalo" }, { connectionId: "sbx-zalo" }], missing: ["sepay"] })
        expect(attachEveryOf(lines, isSandbox, "prod")).toEqual({ wishes: [{ connectionId: "live-zalo" }], missing: ["sepay"] })
    })
})

describe("SeedStandardService.apply --dry: what the bring-up would do, by name, never a value", () => {
    it("prints READY, every secret member by name and state, the tally, and writes nothing", async () => {
        const world = worldOf()

        await world.service.apply(declaration(COMMIT_A), "dev", true)

        expect(world.connections.size).toBe(0)
        expect(world.receipts.size).toBe(0)
        expect(world.printed.some((line) => line.startsWith(`${NAME}: READY: `))).toBe(true)
        expect(world.printed).toContain(`${NAME}: live account zalo-main (zalo_oa) would use secrets/zalo-main: credential=set`)
        expect(world.printed).toContain(`${NAME}: live account mail (smtp) would use secrets/mail: credential=empty`)
        expect(world.printed.join("\n")).not.toContain(SECRET_ZALO)
        expect(world.printed.join("\n")).not.toContain(SECRET_BANK)
    })
})

describe("a FORCED re-seed keeps relations (R102)", () => {
    it("seed, operate, force with a changed standard: ids unchanged, operational rows intact, a person's credential and truth kept, nothing deleted", async () => {
        const world = worldOf()
        await world.service.apply(declaration(COMMIT_A), "dev", false)
        const workspaceId = "ws-Shop"
        const zalo = connectionIdOf(STANDARD, "zalo-main")
        const bank = connectionIdOf(STANDARD, "bank")
        const ids = [...world.connections.keys()].toSorted()
        // Operate: a contact and a route on the seeded Zalo account; a person rotates the bank credential and restates the delivery fee.
        world.tick("2026-11-15T08:00:00.000Z")
        world.operational.contacts.push({ id: "contact-1", connectionId: zalo })
        world.operational.routes.push({ id: "route-1", connectionId: zalo })
        await world.connectionService.writeSecret(bank, "rotated-by-person")
        const fee = [...world.facts.values()].find((one) => one.attributeLabel === "Phí giao")
        world.facts.set(fee?.id ?? "", { ...(fee as FactRecord), status: "superseded" } as FactRecord)
        const personal = world.propose({ subjectType: "policy", subjectLabel: "Giao hàng", attributeLabel: "Phí giao", value: "25.000 đ", sourceKind: "owner" } as FactInput, "owner-1")
        world.facts.set(personal.id, { ...personal, status: "active" } as FactRecord)
        // The standard changes: a new name for the Zalo account, a new fee, a new Zalo credential, the sandbox account dropped.
        const changed = documentOf()
        world.files.set("seed.json", JSON.stringify({ ...changed, accounts: (changed.accounts as Array<Record<string, unknown>>).filter((one) => one.key !== "zalo-sbx").map((one) => (one.key === "zalo-main" ? { ...one, name: "Zalo OA chính" } : one)), truths: [{ type: "policy", subject: "Giao hàng", attribute: "Phí giao", value: "40.000 đ" }, { type: "product", subject: "Bó hồng", attribute: "Giá", value: "350.000 đ" }] }))
        world.setSealed({ ...SEALED, accounts: { ...(SEALED.opened ? SEALED.accounts : {}), "zalo-main": { credential: "zalo-secret-value-2" } } } as SealedValues)
        world.tick("2026-11-16T08:00:00.000Z")
        world.printed.length = 0

        await world.service.apply(declaration(COMMIT_B, { force: true }), "dev", false)

        expect([...world.connections.keys()].toSorted()).toEqual(ids)
        expect(world.connections.get(zalo)?.name).toBe("Zalo OA chính")
        expect(world.secrets.get(zalo)?.plain).toBe("zalo-secret-value-2")
        expect(world.secrets.get(bank)?.plain).toBe("rotated-by-person")
        expect(world.operational).toEqual({ contacts: [{ id: "contact-1", connectionId: zalo }], routes: [{ id: "route-1", connectionId: zalo }] })
        expect([...world.facts.values()].filter((one) => one.attributeLabel === "Phí giao" && one.status === "active").map((one) => one.value)).toEqual(["25.000 đ"])
        expect(world.printed).toContain(`${NAME}: account ${connectionIdOf(STANDARD, "zalo-sbx")} (zalo_oa) is no longer in the standard: kept (removal is a person's act)`)
        expect(world.printed).toContain(`${NAME}: create 0, update 2, leave 2 changed by a person, 1 no longer in the standard (kept)`)
        expect(world.receipts.get(`${NAME}|dev`)).toMatchObject({ commit: COMMIT_B, forcedCommit: COMMIT_B })
        expect(world.printed.join("\n")).not.toContain("zalo-secret-value-2")

        // The same stack text again: the force is consumed at this commit.
        world.printed.length = 0
        await world.service.apply(declaration(COMMIT_B, { force: true }), "dev", false)
        expect(world.printed[0]).toContain("force consumed at this commit")
    })

    it("overwrites a credential a person rotated only when the force names `credentials`", async () => {
        const world = worldOf()
        await world.service.apply(declaration(COMMIT_A), "dev", false)
        const bank = connectionIdOf(STANDARD, "bank")
        world.tick("2026-11-15T08:00:00.000Z")
        await world.connectionService.writeSecret(bank, "rotated-by-person")
        world.tick("2026-11-16T08:00:00.000Z")

        await world.service.apply(declaration(COMMIT_B, { force: true, forceKinds: ["credentials"] }), "dev", false)

        expect(world.secrets.get(bank)?.plain).toBe(SECRET_BANK)
    })
})
