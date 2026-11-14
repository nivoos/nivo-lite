import type { Provider } from "@nestjs/common"
import { AI_RUNNER_ROUTE } from "@modules/integrations/ai"
import { ModelProviderModule } from "./model-provider.module"
import { ModelProviderRegistrationService } from "./model-provider-registration.service"
import { ModelRouteService } from "./model-route.service"

/** What a provider entry of the module provides: its class, or its token. */
const tokenOf = (entry: Provider): unknown => (typeof entry === "function" ? entry : entry.provide)

describe("ModelProviderModule: the switch decides whether the account route exists at all", () => {
    it("PROVIDER_SANDBOX_ENABLED off (production): no route and no AI_RUNNER_ROUTE bound: every model call goes to the endpoint", () => {
        const module = ModelProviderModule.register({ sandbox: { enabled: false } })
        const tokens = (module.providers ?? []).map(tokenOf)
        expect(tokens).not.toContain(ModelRouteService)
        expect(tokens).not.toContain(AI_RUNNER_ROUTE)
        expect(module.exports).not.toContain(AI_RUNNER_ROUTE)
        // The registry, the ports and the catalogue still register (the gate's law), but nothing can reach them.
        expect(tokens).toContain(ModelProviderRegistrationService)
    })

    it("switch on (dev): the route is bound as AI_RUNNER_ROUTE and exported for the model door", () => {
        const module = ModelProviderModule.register({ sandbox: { enabled: true } })
        const tokens = (module.providers ?? []).map(tokenOf)
        expect(tokens).toEqual(expect.arrayContaining([ModelRouteService, AI_RUNNER_ROUTE]))
        expect(module.exports).toContain(AI_RUNNER_ROUTE)
    })
})
