import type { ProviderAccount } from "@starci/nivoos-sdk"
import { GoogleDriveProvider } from "@starci/nivoos-provider-templates/google/google-drive.provider.cell"

/**
 * The Google Drive folder of shoots and cuts, `drive-marketing`. Google signs in with OAuth (no secret is given at deploy): a person connects it in the console after the deploy, so it is
 * optional until then.
 */
export class DriveMarketing implements ProviderAccount<typeof GoogleDriveProvider> {
    readonly key = "drive-marketing"
    readonly provider = GoogleDriveProvider
    readonly title = { vi: "Google Drive marketing", en: "Marketing Google Drive" }
    readonly required = false
    readonly fields = {}
    readonly secrets = {}
}
