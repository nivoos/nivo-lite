import { mock } from "@starci/jest-preset"
import type { BrainPolicyStoreService } from "@modules/domain/brain"
import type { BrainFactsService, FactRecord } from "@modules/domain/brain-facts"
import type { ConnectionApiTokenService } from "@modules/domain/connection-secrets"
import type { ConnectionRecord, ConnectionsService } from "@modules/domain/connections"
import type { InstallationRecordsService } from "@modules/domain/module-installations"
import type { WorkspacesService } from "@modules/domain/workspaces"
import { WorkspaceSeedErrorCode } from "./errors/workspace-seed.error"
import type { SeedStandardTarget } from "./seed-standard.port"
import { SeedStandardExportService } from "./seed-standard-export.service"
import { readSeedDocument } from "./set-seed.policy"
import type { WorkspaceSeedOptions } from "./workspace-seed.options"

/**
 * THE EXPORT DOOR with fakes for the app's sealed store and for the target's encrypt function: no credential leaves except through `seal`;
 * nothing printed, written as text or thrown carries a value; the written document is a valid workspace seed of the one schema.
 */
jest.mock("@modules/domain/installed-plugins", () => ({
    INSTALLED: { templatesOf: (module: string) => [{ id: `${module}.main`, primary: true, versions: [{ version: 1 }] }] },
}))
jest.mock("@modules/domain/channel-provisioning", () => ({ placeOf: (environment: string) => ({ dev: "local", production: "prod" })[environment] }))
jest.mock("@modules/domain/brain", () => ({ BrainPolicyStoreService: class {} }))
jest.mock("@modules/domain/brain-facts", () => ({ BrainFactsService: class {} }))
jest.mock("@modules/domain/connection-secrets", () => ({ ConnectionApiTokenService: class {}, randomSecret: () => "random-hook" }))
jest.mock("@modules/domain/connections", () => ({ ConnectionsService: class {} }))
jest.mock("@modules/domain/module-installations", () => ({ InstallationRecordsService: class {} }))
jest.mock("@modules/domain/workspaces", () => ({ WorkspacesService: class {} }))

const VALUE = "live-credential-value-1"
const HOOK = "live-webhook-value-1"
const COMMIT = "c".repeat(40)

const setup = (existing: string | null) => {
    const printed: Array<string> = []
    const written = new Map<string, string>()
    const sealedCalls: Array<{ readonly path: string; readonly values: Readonly<Record<string, Readonly<Record<string, string>>>> }> = []
    const target: SeedStandardTarget = {
        readText: (path) => Promise.resolve(path === "seed.json" ? existing : null),
        writeText: (path, text) => {
            written.set(path, text)
            return Promise.resolve(true)
        },
        seal: (path, values) => {
            sealedCalls.push({ path, values })
            return Promise.resolve(true)
        },
    }
    const workspaces = mock<WorkspacesService>()
    workspaces.list.mockResolvedValue([{ id: "ws-1", name: "Shop" }] as never)
    workspaces.isLive.mockResolvedValue(true)
    const connections = mock<ConnectionsService>()
    connections.list.mockResolvedValue([
        { id: "c-2", workspaceId: "ws-1", provider: "zalo_oa", name: "Zalo chính", meta: { app_id: "123" }, sandbox: false },
        { id: "c-1", workspaceId: "ws-1", provider: "sepay", name: "Sandbox SePay", meta: {}, sandbox: true },
    ] as unknown as ReadonlyArray<ConnectionRecord>)
    connections.readSecret.mockResolvedValue({ plain: VALUE, webhookSecret: HOOK })
    const installations = mock<InstallationRecordsService>()
    installations.list.mockResolvedValue([{ moduleKey: "chatbot" }] as never)
    const facts = mock<BrainFactsService>()
    facts.list.mockResolvedValue([
        { subjectType: "policy", subjectKey: "giao-hang", subjectLabel: "Giao hàng", attribute: "phi-giao", attributeLabel: "Phí giao", value: "30.000 đ", unit: null, scope: "public", sourceKind: "owner", validFrom: null, validTo: null, installationId: null },
        { subjectType: "business", subjectKey: "x", subjectLabel: "X", attribute: "y", attributeLabel: "Y", value: "z", unit: null, scope: "public", sourceKind: "customer", validFrom: null, validTo: null, installationId: null },
    ] as unknown as ReadonlyArray<FactRecord>)
    const judgements = mock<BrainPolicyStoreService>()
    judgements.all.mockResolvedValue([{ subjectKey: "giao-hang", attribute: "phi-giao", installationId: null, kind: "policy", title: "Phí giao hàng", groupLabel: "Giao hàng" }] as never)
    const options = { print: (line: string) => printed.push(line) } as unknown as WorkspaceSeedOptions
    const apiTokens = mock<ConnectionApiTokenService>()
    apiTokens.read.mockResolvedValue(null)
    const service = new SeedStandardExportService(options, workspaces, connections, installations, facts, judgements, apiTokens, { open: () => Promise.resolve(target) })
    return { service, printed, written, sealedCalls, connections }
}

const EXISTING = JSON.stringify({ name: "shop-seed-standard", ownerWorkspace: "NIVO", target: "local", plugins: [{ key: "core", version: "0.1.0" }], accounts: [{ key: "zalo-main", provider: "zalo_oa", name: "Zalo chính", sandbox: false }] })

describe("SeedStandardExportService.export", () => {
    it("hands every credential ONLY to the encrypt function and writes a valid workspace seed that names the secret members", async () => {
        const { service, printed, written, sealedCalls } = setup(EXISTING)

        await service.export("Shop", "D:/Repositories/shop-seed-standard", "dev")

        expect(sealedCalls).toEqual([{ path: "secrets.dev.enc.yaml", values: { "zalo-main": { credential: VALUE, webhookSecret: HOOK } } }])
        const text = written.get("seed.json") ?? ""
        expect(text).not.toContain(VALUE)
        expect(text).not.toContain(HOOK)
        expect(printed.join("\n")).not.toContain(VALUE)
        const profile = readSeedDocument(text, { name: "shop-seed-standard", commit: COMMIT })
        expect(profile.accounts.map((one) => [one.key, one.sandbox, one.secrets])).toEqual([
            ["sepay-1", true, []],
            ["zalo-main", false, ["credential", "webhookSecret"]],
        ])
        expect(profile.agents).toEqual([{ module: "chatbot", template: "chatbot.main", version: 1 }])
        expect(profile.truths).toEqual([expect.objectContaining({ attribute: "Phí giao", policy: { title: "Phí giao hàng", group: "Giao hàng" } })])
        expect(printed.at(-1)).toContain("1 not a seed's source")
        expect(Object.keys(JSON.parse(text) as object)).not.toEqual(expect.arrayContaining(["people"]))
        expect(profile.people).toEqual([])
    })

    it("refuses a checkout with no seed document (the name and the owner are curated, never invented) and carries no value in the error", async () => {
        const { service, sealedCalls } = setup(null)

        const failure = await service.export("Shop", "D:/x", "dev").catch((error: unknown) => error)

        expect(failure).toMatchObject({ code: WorkspaceSeedErrorCode.InputInvalid })
        expect(JSON.stringify(failure)).not.toContain(VALUE)
        expect(sealedCalls).toEqual([])
    })

    it("credentials-only: seals the CURRENT credential (rotated tokens included) of the matching live connection, writes no seed.json, names the unmatched", async () => {
        const { service, printed, written, sealedCalls } = setup(JSON.stringify({ name: "shop-seed-standard", ownerWorkspace: "NIVO", accounts: [
            { key: "zalo-shop", provider: "zalo_oa", name: "Zalo OA của tiệm", sandbox: false, secrets: ["credential", "fact.app_id"] },
            { key: "bank", provider: "sepay", name: "Bank", sandbox: false, secrets: ["credential"] },
        ] }))

        await service.export("Shop", "D:/x", "dev", true)

        expect(written.size).toBe(0)
        expect(sealedCalls).toEqual([{ path: "secrets.dev.enc.yaml", values: { "zalo-shop": { credential: VALUE, "fact.app_id": "123" } } }])
        expect(printed.at(-1)).toContain("no live connection of the workspace for: bank")
        expect(printed.join(" ")).not.toContain(VALUE)
    })

    it("refuses with a typed reason when no target driver is bound", async () => {
        const bare = new SeedStandardExportService({ print: () => undefined } as unknown as WorkspaceSeedOptions, mock<WorkspacesService>(), mock<ConnectionsService>(), mock<InstallationRecordsService>(), mock<BrainFactsService>(), mock<BrainPolicyStoreService>(), mock<ConnectionApiTokenService>())

        await expect(bare.export("Shop", "D:/x", "dev")).rejects.toMatchObject({ code: WorkspaceSeedErrorCode.DriverMissing })
    })
})
