import { defineProviderTemplate, type ProviderTemplate } from "@nivo-lite/agent-sdk/installation"
import { CRM_NIVOWEB } from "./api.generated"
import openapi from "./openapi.json"

/**
 * NIVO Web's CRM, the one CRM this package is written against (owner decision 2026-11-14): its id `nivoweb` is declared HERE only; the
 * document the package pins beside this file is the one its operation constants (`api.generated.ts`) are generated from, and the one a
 * live system's document is checked against when a shop connects it. The CRM serves its document at `/openapi.json` under its API base URL
 * and takes a bearer service credential (`serviceKey`, issued per enterprise workspace by the CRM's `cli credential issue`).
 */
export const NIVOWEB_CRM: ProviderTemplate = defineProviderTemplate({
    kind: "crm",
    id: "nivoweb",
    label: { vi: "CRM NIVO Web", en: "NIVO Web CRM" },
    openapi,
    swaggerPath: "/openapi.json",
    auth: { type: "bearer" },
    baseUrlHint: "https://crm.nivoweb.vn",
    // The NIVO Sandbox's answers of this CRM, by operation (OPENAPI-1 default, -2 refused, -3 failed). ONE example proving the shape; the
    // other operations' fixtures are the package's open need (`## SDK-CLEAN` in the lane notes), until then they answer PROVIDER_SANDBOX_CASE_UNKNOWN.
    sandbox: {
        [CRM_NIVOWEB.get_prices]: {
            status: 200,
            body: {
                items: [
                    {
                        priceCode: "HOSTING-STARTER-12",
                        name: "Hosting Starter 12 tháng",
                        kind: "new",
                        serviceClass: "hosting",
                        termMonths: 12,
                        setupVnd: 0,
                        netVnd: 1_200_000,
                        vatRatePercent: 10,
                        vatVnd: 120_000,
                        totalVnd: 1_320_000,
                        instalmentPercents: [],
                        priceSource: "placeholder",
                    },
                ],
                nextCursor: null,
            },
            refused: { status: 404, body: { code: "price_not_found", message: "no such price" } },
            failed: { status: 503, body: { code: "unavailable", message: "the CRM is not answering" } },
        },
    },
})
