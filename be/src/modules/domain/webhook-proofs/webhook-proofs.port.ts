import type { WebhookProofVerdict } from "@modules/platform/http-security"
import type { ScopedWebhookDelivery } from "./webhook-proofs.contracts"

/** Authenticates scoped provider deliveries before a domain intake accepts them. */
export interface WebhookVerifier {
    /** The verdict of a delivery (`proven` or `unproven`, which its intake obeys); a refused delivery throws. */
    verify(delivery: ScopedWebhookDelivery): Promise<WebhookProofVerdict>
}
