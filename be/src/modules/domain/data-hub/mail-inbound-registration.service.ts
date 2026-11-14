import { Injectable, type OnModuleInit } from "@nestjs/common"
import { AccountDataAdmissionsService } from "@modules/domain/account-data"
import { IMAP_MAIL_TYPE } from "@modules/domain/data-records"
import { PollReceiverRegistryService } from "@modules/domain/provider-registry"
import { SandboxCatalogueRegistryService } from "@modules/domain/provider-sandbox"
import { ImapInboxPollerService } from "./imap-inbox-poller.service"
import { IMAP_SANDBOX_CATALOGUE, MAILBOX_INBOUND_SANDBOX_CATALOGUE } from "./imap-sandbox.catalogue"
import { ImapSandboxPollerService } from "./imap-sandbox-poller.service"
import { MailAdmissionService } from "./mail-admission.service"

@Injectable()
/**
 * A mailbox's inbound half as the ONE poll job reads it (owner R95; providers rule 12): its POLL RECEIVER (live IMAP or its sandbox twin,
 * registered once with both) and the ADMISSION of a new `imap.mail` row. The accounts of the half's provider (`imap`) and of every provider
 * that holds the half (a mailbox `smtp` account) are read by the same receiver (the poll job resolves an account's receiver through the
 * half it holds). It also hands the sandbox page the inbound cases under both account kinds, so ONE mailbox account answers `SMTP-*` and
 * `IMAP-*`.
 */
export class MailInboundRegistrationService implements OnModuleInit {
    constructor(
        private readonly receivers: PollReceiverRegistryService,
        private readonly admissions: AccountDataAdmissionsService,
        private readonly catalogues: SandboxCatalogueRegistryService,
        private readonly live: ImapInboxPollerService,
        private readonly sandbox: ImapSandboxPollerService,
        private readonly mail: MailAdmissionService,
    ) {}

    /** Registers the receiver (live and sandbox), the admission of `imap.mail` and the sandbox cases, once. */
    onModuleInit(): void {
        this.receivers.register({ live: this.live, sandbox: this.sandbox })
        this.admissions.register(IMAP_MAIL_TYPE, (tx, row) => this.mail.admit(tx, row))
        this.catalogues.register(IMAP_SANDBOX_CATALOGUE)
        this.catalogues.register(MAILBOX_INBOUND_SANDBOX_CATALOGUE)
    }
}
