import { Injectable, type OnModuleInit } from "@nestjs/common"
import { SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import { ModelLiveRunnerService } from "./model-live-runner.service"
import { ModelProviderRegistryService } from "./model-provider-registry.service"
import { ModelSandboxRunnerService } from "./model-sandbox-runner.service"
import { MODEL_SANDBOX_CATALOGUE } from "./model-sandbox.catalogue"

@Injectable()
/**
 * Registers the model provider once, when the app starts: its live port (the deployment's endpoint) with its sandbox twin on the model
 * registry (`{ live, sandbox }`: the law of R59 and its gate), and its hardcoded catalogue for the Sandbox page.
 */
export class ModelProviderRegistrationService implements OnModuleInit {
    constructor(
        private readonly registry: ModelProviderRegistryService,
        private readonly live: ModelLiveRunnerService,
        private readonly sandbox: ModelSandboxRunnerService,
        private readonly catalogues: SandboxCatalogueRegistryService,
    ) {}

    /** Registers the live and sandbox runners and the catalogue. */
    onModuleInit(): void {
        this.registry.register({ live: this.live, sandbox: this.sandbox })
        this.catalogues.register(MODEL_SANDBOX_CATALOGUE)
    }
}
