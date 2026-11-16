import { Injectable, type OnModuleInit } from "@nestjs/common"
import { ConnectionsService } from "@modules/domain/connections"
import { PaymentRequestRegistryService } from "@modules/domain/provider-registry"
import { SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import { PayosPaymentLinkService } from "./payos-payment-link.service"
import { PayosPaymentRequestAdapter } from "./payos-payment-request.adapter"
import { PAYOS_SANDBOX_CATALOGUE } from "./payos-sandbox.catalogue"
import { PayosSandboxPaymentLinkService } from "./payos-sandbox-payment-link.service"

@Injectable()
/**
 * Hands payOS's payment request (owner ruling R111: its adapter over the live link service and over the sandbox twin, the return page under
 * the environment's site origin) to the registry that asks for it, and the sandbox catalogue to the catalogue registry, once, when the app
 * starts.
 */
export class PayosProviderRegistrationService implements OnModuleInit {
    constructor(
        private readonly requests: PaymentRequestRegistryService,
        private readonly link: PayosPaymentLinkService,
        private readonly linkSandbox: PayosSandboxPaymentLinkService,
        private readonly connections: ConnectionsService,
        private readonly catalogues: SandboxCatalogueRegistryService,
    ) {}

    /** Hands the capability to its registry. */
    onModuleInit(): void {
        const siteBase = (): string => this.connections.siteBase()
        this.requests.register({
            live: new PayosPaymentRequestAdapter(this.link, siteBase),
            sandbox: new PayosPaymentRequestAdapter(this.linkSandbox, siteBase),
        })
        this.catalogues.register(PAYOS_SANDBOX_CATALOGUE)
    }
}
