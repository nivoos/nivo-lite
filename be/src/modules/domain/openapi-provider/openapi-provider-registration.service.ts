import { Injectable, type OnModuleInit } from "@nestjs/common"
import type { ProviderTemplate } from "@nivo-lite/agent-sdk/installation"
import { CRM_TEMPLATES } from "@modules/domain/openapi-tools"
import { SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import { OPENAPI_SANDBOX_CATALOGUE } from "./openapi-sandbox.catalogue"
import { OpenApiSandboxFixturesRegistryService } from "./openapi-sandbox-fixtures-registry.service"
import { sandboxFixturesOf } from "./openapi-sandbox-fixtures.policy"

@Injectable()
/**
 * Hands the OpenAPI provider's sandbox catalogue to the catalogue registry, and the sandbox fixtures the installed packages ship with
 * their provider templates to the fixtures registry, once, when the app starts. The reach itself is registered `{ live, sandbox }`
 * where its live twin lives (the app that makes outbound calls: the native tools), on `OpenApiReachRegistryService`.
 */
export class OpenApiProviderRegistrationService implements OnModuleInit {
    constructor(
        private readonly catalogues: SandboxCatalogueRegistryService,
        private readonly fixtures: OpenApiSandboxFixturesRegistryService,
    ) {}

    /** Registers the OpenAPI sandbox catalogue and the installed packages' fixtures. */
    onModuleInit(): void {
        this.catalogues.register(OPENAPI_SANDBOX_CATALOGUE)
        this.registerFixtures(CRM_TEMPLATES)
    }

    /**
     * Registers the sandbox of every template: its pinned document (every operation of it is answered by the generic store) and the
     * declarations it ships (none: the store starts empty).
     */
    registerFixtures(templates: ReadonlyArray<ProviderTemplate>): void {
        for (const template of templates) this.fixtures.register(sandboxFixturesOf(template).fixtures)
    }
}
