import { Injectable, Optional } from "@nestjs/common"
import { SandboxWebhookKeyService } from "@modules/domain/provider-sandbox"
import { InjectWebhookProofRegistry, type WebhookProofRegistry, type WebhookProofVerdict } from "@modules/platform/http-security"

import type { ScopedWebhookDelivery } from "./webhook-proofs.contracts"
import type { WebhookVerifier } from "./webhook-proofs.port"

@Injectable()
/**
 * THE ONE PLACE a scoped webhook delivery's proof is decided (rulings R58 + R60, E-FIX10). RULE: a delivery to a SANDBOX account is proven by
 * the sandbox key the shared guard checked; a provider's own proof (a signature or token under the account's secret) is asked only of a LIVE
 * account. The verdict is handed to the door's intake, which obeys it and never decides proof again (no intake reads a secret to learn
 * whether a delivery was proven).
 */
export class ScopedWebhookVerifier implements WebhookVerifier {
    constructor(
        @InjectWebhookProofRegistry() private readonly proofs: WebhookProofRegistry,
        @Optional() private readonly sandboxes?: SandboxWebhookKeyService,
    ) {}

    /**
     * The verdict of one delivery: the shared sandbox guard is asked first; a SANDBOX account's delivery is `proven` by its sandbox key (or
     * refused) and never meets the provider proof it holds no secret for; every other delivery (a live account, an unknown scope, an app
     * with no sandbox) gets the provider's registered proof exactly as before, whose `unproven` answer is carried as is. A refusal throws.
     */
    async verify(delivery: ScopedWebhookDelivery): Promise<WebhookProofVerdict> {
        const verdict = await this.sandboxes?.verdictOf(delivery.scope, delivery.sandboxKey)
        if (verdict?.kind === "sandbox") return "proven"
        return this.proofs.verify(delivery.provider, {
            scope: delivery.scope,
            rawBody: delivery.rawBody,
            signature: delivery.signature,
            timestamp: delivery.timestamp,
        })
    }
}
