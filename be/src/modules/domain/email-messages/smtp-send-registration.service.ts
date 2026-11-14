import { Injectable, Optional, type OnModuleInit } from "@nestjs/common"
import { CustomerSendRegistryService } from "@modules/domain/channels"
import { SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import { MailCustomerSendService } from "./mail-customer-send.service"
import { SmtpLiveSendService } from "./smtp-live-send.service"
import { SmtpSendRegistryService } from "./smtp-send-registry.service"
import { SMTP_SANDBOX_CATALOGUE } from "./smtp-sandbox.catalogue"
import { SmtpSandboxSendService } from "./smtp-sandbox-send.service"

@Injectable()
/**
 * Hands the workspace SMTP send (live and sandbox) to its registry and its sandbox catalogue to the sandbox page's registry, once, when the
 * app starts; and the customer channel `email` of the one customer send (rule SO-1) to the customer-send registry, in an app that composes
 * it (the CLI does not).
 */
export class SmtpSendRegistrationService implements OnModuleInit {
    constructor(
        private readonly senders: SmtpSendRegistryService,
        private readonly sendLive: SmtpLiveSendService,
        private readonly sendSandbox: SmtpSandboxSendService,
        private readonly catalogues: SandboxCatalogueRegistryService,
        private readonly mailSend: MailCustomerSendService,
        @Optional() private readonly customerSends?: CustomerSendRegistryService,
    ) {}

    /** Registers both implementations under `smtp` and the catalogue of the sandbox's cases. */
    onModuleInit(): void {
        this.senders.register({ live: this.sendLive, sandbox: this.sendSandbox })
        this.catalogues.register(SMTP_SANDBOX_CATALOGUE)
        // One instance for both: it holds no provider client; the SMTP registry above is the account's live | sandbox switch.
        this.customerSends?.register({ live: this.mailSend, sandbox: this.mailSend })
    }
}
