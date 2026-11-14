import { CommandHandler } from "@nestjs/cqrs"
import { AgentWorkAccessService } from "@modules/domain/agent-work"
import { ContactsService } from "@modules/domain/contacts"
import { ICQRSHandler } from "@modules/platform/cqrs"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import type { SetContactConsentView } from "./contact-consent.contracts"
import { consentViewOf } from "./contact-consent.views"
import { ContactNamesService } from "./contact-names.service"
import { SetContactConsentCommand } from "./contacts.commands"

@CommandHandler(SetContactConsentCommand)
/**
 * A person sets or clears the contact's "do not contact" (`setContactDoNotContact`): the one place it is cleared. Owner or manager; the
 * change is audited on the contact with the member and the reason.
 */
export class SetContactConsentHandler extends ICQRSHandler<SetContactConsentCommand, SetContactConsentView> {
    constructor(
        @InjectLogger() logger: Logger,
        private readonly access: AgentWorkAccessService,
        private readonly contacts: ContactsService,
        private readonly names: ContactNamesService,
    ) {
        super(logger)
    }

    protected override async process(command: SetContactConsentCommand): Promise<SetContactConsentView> {
        const { request, principal } = command.params
        const memberId = await this.access.manager(principal.id, request.workspaceId)
        const outcome = await this.contacts.setConsent(
            request.workspaceId,
            request.contactId,
            { doNotContact: request.doNotContact, reason: request.reason },
            { kind: "member", memberId },
        )
        // A member's change is never `cleared_only_by_person`: the only refusal left is a contact that is gone.
        if (outcome.kind === "refused") return { outcome: "not_found", consent: null }
        return { outcome: outcome.kind, consent: await consentViewOf(this.names, request.workspaceId, outcome.consent) }
    }
}
