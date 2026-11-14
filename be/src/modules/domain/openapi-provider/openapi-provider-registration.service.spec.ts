import type { ProviderTemplate } from "@nivo-lite/agent-sdk/installation"
import { CRM_TEMPLATES } from "@modules/domain/openapi-tools"
import { SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import { OPENAPI_SANDBOX_CATALOGUE } from "./openapi-sandbox.catalogue"
import { OpenApiSandboxFixturesRegistryService } from "./openapi-sandbox-fixtures-registry.service"
import { OpenApiProviderRegistrationService } from "./openapi-provider-registration.service"

const DOCUMENT = {
    openapi: "3.1.0",
    paths: { "/prices": { get: { operationId: "price.list", responses: { "200": { description: "" } } } } },
}

const template = (sandbox: ProviderTemplate["sandbox"]): ProviderTemplate => ({
    kind: "crm",
    id: "sample",
    label: { vi: "CRM mau", en: "Sample CRM" },
    openapi: DOCUMENT,
    swaggerPath: "/openapi.json",
    auth: { type: "bearer" },
    baseUrlHint: "https://crm.example.test",
    sandbox,
})

const setup = () => {
    const catalogues = new SandboxCatalogueRegistryService()
    const fixtures = new OpenApiSandboxFixturesRegistryService()
    return { catalogues, fixtures, service: new OpenApiProviderRegistrationService(catalogues, fixtures) }
}

describe("OpenApiProviderRegistrationService", () => {
    it("hands the fixtures of the templates that ship any to the fixtures registry, by connector and operation id", () => {
        const { fixtures, service } = setup()
        service.registerFixtures([
            template({ "nivo.api.crm.sample.get.prices": { status: 200, body: { items: [] } } }),
            { ...template(undefined), id: "bare" },
        ])
        expect(fixtures.connectors()).toEqual(["crm.sample"])
        expect(fixtures.of("crm.sample")?.operations["price.list"]).toEqual({ status: 200, body: { items: [] } })
    })

    it("registers the sandbox catalogue and the installed CRM templates' fixtures when the app starts", () => {
        const { catalogues, fixtures, service } = setup()
        service.onModuleInit()
        expect(catalogues.providers()).toContain(OPENAPI_SANDBOX_CATALOGUE.provider)
        const shipping = CRM_TEMPLATES.filter((one) => one.sandbox !== undefined).map((one) => `crm.${one.id}`)
        expect(fixtures.connectors()).toEqual(shipping)
    })
})
