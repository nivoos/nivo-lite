import { QueryHandler } from "@nestjs/cqrs"
import { AgentWorkAccessService } from "@modules/domain/agent-work"
import { ContactsService } from "@modules/domain/contacts"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import type { ContactConsentView } from "./contact-consent.contracts"
import { consentViewOf } from "./contact-consent.views"
import { ContactNamesService } from "./contact-names.service"
import { ReadContactConsentQuery } from "./contacts.queries"

@QueryHandler(ReadContactConsentQuery)
/**
 * The contact's ONE consent fact for the contacts page (`contact.doNotContact`): may the shop write to this person first, when it was
 * set, by whom and why. The page seat (owner or manager). A missing or deleted contact answers null.
 */
export class ReadContactConsentHandler extends ICQRSHandler<ReadContactConsentQuery, ContactConsentView | null> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly access: AgentWorkAccessService,
        private readonly contacts: ContactsService,
        private readonly names: ContactNamesService,
    ) {
        super(logger)
    }

    protected override async process(query: ReadContactConsentQuery): Promise<ContactConsentView | null> {
        const { request, principal } = query.params
        await this.access.manager(principal.id, request.workspaceId)
        const consent = await this.contacts.consentOf(request.workspaceId, request.contactId)
        return consent === null ? null : consentViewOf(this.names, request.workspaceId, consent)
    }
}
