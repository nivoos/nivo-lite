import { env, secret, type ProviderAccount } from "@starci/nivoos-sdk"
import { SepayProvider } from "@starci/nivoos-provider-templates/sepay/sepay.provider.cell"

/**
 * NIVO's own company bank account in SePay, `sepay-nivo`: a customer's transfer with the pay code `NIVO<dealCode>` in its memo is the payment of a deal. The account number is read
 * from `SEPAY_NIVO_ACCOUNT_NUMBER`, the API token and the webhook secret from the secrets file.
 */
export class SepayNivo implements ProviderAccount<typeof SepayProvider> {
    readonly key = "sepay-nivo"
    readonly provider = SepayProvider
    readonly title = { vi: "Tài khoản ngân hàng NIVO (SePay)", en: "NIVO bank account (SePay)" }
    readonly fields = { accountNumber: env("SEPAY_NIVO_ACCOUNT_NUMBER") }
    readonly secrets = { apiToken: secret("SEPAY_NIVO_API_TOKEN"), webhookSecret: secret("SEPAY_NIVO_WEBHOOK_SECRET") }
}
