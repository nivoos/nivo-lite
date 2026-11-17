import type { ProviderAccount } from "@starci/nivoos-sdk"
import { GoogleProvider } from "@starci/nivoos-provider-templates/google/google.provider.cell"

/**
 * The marketing spreadsheet, `sheets-marketing`: the content calendar mirror, the lead import and the KPI sheet. Connected with Google sign-in in the console after the deploy, so it is
 * optional until then.
 */
export class SheetsMarketing implements ProviderAccount<typeof GoogleProvider> {
    readonly key = "sheets-marketing"
    readonly provider = GoogleProvider
    readonly title = { vi: "Google Sheets marketing", en: "Marketing Google Sheets" }
    readonly required = false
    readonly fields = {}
    readonly secrets = {}
}
