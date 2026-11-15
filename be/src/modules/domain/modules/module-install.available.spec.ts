import { Test } from "@nestjs/testing"
import { fakeTransaction, mock, mockEntityManager } from "@starci/jest-preset"
import { AgentIdentityService, AgentsService } from "@modules/domain/agents"
import { EventsService } from "@modules/domain/events"
import { InstallationRecordsService } from "@modules/domain/module-installations"
import { WorkspaceMembersService } from "@modules/domain/workspace-members"
import { WorkspaceEnterpriseService } from "@modules/domain/workspaces"
import { PRIMARY_ENTITY_MANAGER } from "@modules/platform/database"
import { FIXTURE_MODULE } from "@tests/fixtures/builders/fixture-plugin.builder"
import {
    INSTALLING_MEMBER as MEMBER,
    installAgentOf as agentOf,
    installationRecordOf as recordOf,
} from "@tests/fixtures/builders/module-install.builder"
import {
    INSTALL_VIEWED as VIEWED,
    installRequestOf as requestOf,
} from "@tests/fixtures/builders/module-install-service.builder"
import { ModulesErrorCode } from "./errors/modules.error"
import { InstallationChangesService } from "./installation-changes.service"
import { InstallationFactsService } from "./installation-facts.service"
import { ModuleInstallService } from "./module-install.service"
import { ModuleReadinessService } from "./module-readiness.service"
import type { ModuleDefinition } from "./modules.contracts"
import { ModulesService } from "./modules.service"
import { catalogModuleOf } from "./modules.testing"
import { RecordInstallationService } from "./record-installation.service"

// The installation holds the core plugin and a private fixture plugin (module `fixdesk`, open to the enterprise workspaces).
jest.mock("@nivo-lite/plugin-registry", () => {
    const parts: typeof import("@tests/fixtures/builders/installation-parts.builder") = jest.requireActual(
        "@tests/fixtures/builders/installation-parts.builder",
    )
    const fixture: typeof import("@tests/fixtures/builders/fixture-plugin.builder") = jest.requireActual(
        "@tests/fixtures/builders/fixture-plugin.builder",
    )
    return { installed: parts.installationWith([fixture.FIXTURE_PLUGIN], "fixture-array") }
})

const CHATBOT = catalogModuleOf("chatbot")
const SALES = catalogModuleOf("sales")
const DESK: ModuleDefinition = { ...CHATBOT, key: FIXTURE_MODULE, name: { vi: "Ban ho tro", en: "Help desk" }, available: false }

const build = async (module: ModuleDefinition) => {
    const installations = mock<InstallationRecordsService>()
    installations.instanceNames.mockResolvedValue([])
    installations.boundAgentIds.mockResolvedValue([])
    installations.insert.mockResolvedValue("inst-new")
    const members = mock<WorkspaceMembersService>()
    members.require.mockResolvedValue(MEMBER)
    const catalog = mock<ModulesService>()
    catalog.find.mockResolvedValue(module)
    const agents = mock<AgentsService>()
    agents.list.mockResolvedValue([])
    agents.create.mockResolvedValue(agentOf({ id: "agent-new" }))
    const readiness = mock<ModuleReadinessService>()
    readiness.withNeeds.mockImplementation((record) => Promise.resolve({ ...record, ...VIEWED }))
    const enterprise = mock<WorkspaceEnterpriseService>()
    enterprise.opens.mockResolvedValue(true)
    const moduleRef = await Test.createTestingModule({
        providers: [
            ModuleInstallService,
            { provide: PRIMARY_ENTITY_MANAGER, useValue: fakeTransaction(mockEntityManager()).em },
            { provide: InstallationRecordsService, useValue: installations },
            { provide: WorkspaceMembersService, useValue: members },
            { provide: ModulesService, useValue: catalog },
            { provide: AgentsService, useValue: agents },
            { provide: AgentIdentityService, useValue: mock<AgentIdentityService>() },
            { provide: EventsService, useValue: mock<EventsService>() },
            { provide: InstallationChangesService, useValue: mock<InstallationChangesService>() },
            { provide: InstallationFactsService, useValue: mock<InstallationFactsService>() },
            { provide: RecordInstallationService, useValue: mock<RecordInstallationService>() },
            { provide: ModuleReadinessService, useValue: readiness },
            { provide: WorkspaceEnterpriseService, useValue: enterprise },
        ],
    }).compile()
    return { service: moduleRef.get(ModuleInstallService), installations, agents }
}

describe("ModuleInstallService > install, a module that is not available from the catalogue", () => {
    it.each([
        ["a module of the core plugin", SALES, "sales"],
        ["a module of a private plugin (second kind)", DESK, FIXTURE_MODULE],
    ] as const)("refuses to add %s and writes nothing", async (_case, module, key) => {
        const { service, installations, agents } = await build(module)
        installations.firstOfModule.mockResolvedValue(null)
        await expect(service.install("u1", requestOf({ moduleKey: key }))).rejects.toMatchObject({
            code: ModulesErrorCode.NotAvailable,
        })
        expect(agents.create).not.toHaveBeenCalled()
        expect(installations.insert).not.toHaveBeenCalled()
    })

    it("refuses to add another instance of it as well", async () => {
        const { service, installations } = await build({ ...DESK, multiInstance: true })
        await expect(service.install("u1", requestOf({ moduleKey: FIXTURE_MODULE, newInstance: true }))).rejects.toMatchObject({
            code: ModulesErrorCode.NotAvailable,
        })
        expect(installations.insert).not.toHaveBeenCalled()
    })

    it("answers an installation the workspace already has", async () => {
        const { service, installations } = await build(SALES)
        installations.firstOfModule.mockResolvedValue(recordOf({ moduleKey: "sales" }))
        await expect(service.install("u1", requestOf({ moduleKey: "sales" }))).resolves.toMatchObject({ created: false })
        expect(installations.insert).not.toHaveBeenCalled()
    })

    it("lets a platform door install what its package declares as a front door", async () => {
        const { service, installations } = await build(SALES)
        installations.firstOfModule.mockResolvedValue(null)
        await expect(service.install("u1", requestOf({ moduleKey: "sales", platform: true }))).resolves.toMatchObject({
            created: true,
        })
        expect(installations.insert).toHaveBeenCalledTimes(1)
    })

    it("adds an available module as before", async () => {
        const { service, installations } = await build(CHATBOT)
        installations.firstOfModule.mockResolvedValue(null)
        await expect(service.install("u1", requestOf())).resolves.toMatchObject({ created: true })
    })
})
