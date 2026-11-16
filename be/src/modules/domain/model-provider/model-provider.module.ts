import { Module, type DynamicModule } from "@nestjs/common"
import { AI_RUNNER_ROUTE } from "@modules/integrations/ai"
import { ConfigurableModuleClass, OPTIONS_TYPE } from "./model-provider.module-definition"
import { ModelLiveRunnerService } from "./model-live-runner.service"
import { ModelProviderRegistrationService } from "./model-provider-registration.service"
import { ModelProviderRegistryService } from "./model-provider-registry.service"
import { ModelRouteService } from "./model-route.service"
import { ModelSandboxRunnerService } from "./model-sandbox-runner.service"

@Module({})
/**
 * The model endpoint as a provider (lane concept provider-sandbox, the model row): the registry that picks live or sandbox per model
 * account, the live port, the sandbox runner and its catalogue. Register it global in the app whose model calls may be served by a sandbox
 * model account (the api). With the dev switch OFF the account route is not bound: the model door then calls the endpoint for every call
 * and no code path can reach the sandbox runner.
 */
export class ModelProviderModule extends ConfigurableModuleClass {
    /** Registers the model provider once, with the switch the app read. */
    static register(options: typeof OPTIONS_TYPE): DynamicModule {
        const base = super.register(options)
        return {
            ...base,
            providers: [
                ...(base.providers ?? []),
                ModelProviderRegistryService,
                ModelLiveRunnerService,
                ModelSandboxRunnerService,
                ModelProviderRegistrationService,
                // The account route exists ONLY with the switch on: off (production), `AiService` gets no route and calls the endpoint.
                ...(options.sandbox.enabled ? [ModelRouteService, { provide: AI_RUNNER_ROUTE, useExisting: ModelRouteService }] : []),
            ],
            exports: [ModelProviderRegistryService, ...(options.sandbox.enabled ? [AI_RUNNER_ROUTE] : [])],
        }
    }
}
