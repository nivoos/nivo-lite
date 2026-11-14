import { SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import { sandboxServiceOf } from "@tests/fixtures/builders/provider-sandbox.builder"
import { ModelLiveRunnerService } from "./model-live-runner.service"
import { ModelProviderRegistrationService } from "./model-provider-registration.service"
import { ModelProviderRegistryService } from "./model-provider-registry.service"
import { ModelSandboxRunnerService } from "./model-sandbox-runner.service"

describe("ModelProviderRegistrationService", () => {
    it("registers { live, sandbox } on the model registry and the catalogue for the Sandbox page", () => {
        const registry = new ModelProviderRegistryService()
        const catalogues = new SandboxCatalogueRegistryService()
        const live = new ModelLiveRunnerService()
        const sandbox = new ModelSandboxRunnerService(sandboxServiceOf().sandbox)
        new ModelProviderRegistrationService(registry, live, sandbox, catalogues).onModuleInit()
        expect(registry.portFor({ provider: "model", sandbox: false })).toBe(live)
        expect(registry.portFor({ provider: "model", sandbox: true })).toBe(sandbox)
        expect(catalogues.providers()).toEqual(["model"])
        expect(catalogues.casesOf("model").map((one) => one.id)).toHaveLength(7)
    })
})
