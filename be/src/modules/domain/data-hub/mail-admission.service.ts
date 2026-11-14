import { Injectable, Optional } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AccountDataIntakeService, type AdmittedRow } from "@modules/domain/account-data"
import { ProviderTriggersService } from "@modules/domain/provider-triggers"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { DataHubLogEvent } from "./data-hub.log-events"
import { IMAP_MAIL_TRIGGER } from "./imap-mail.trigger"

@Injectable()
/**
 * THE ADMISSION OF A NEW MAIL (owner R95; MAIL-IN rule MI-4; account-data rules 2, 7, 10): a new `imap.mail` row the one poll job kept is the
 * new signal; in the SAME transaction its stored value is handed to the mailbox's trigger (`deliver`: its pure translate, enrich, match,
 * correlate) and the row is completed. Nothing outside NIVO happens between the row and the wake (the files of a mail stay at the mailbox),
 * so no consumer job sits between them: the row and its wake commit together or not at all. A mail no person wrote is no event (the
 * translate's null) and is counted.
 */
export class MailAdmissionService {
    constructor(
        @InjectLogger() private readonly logger: Logger,
        private readonly intake: AccountDataIntakeService,
        @Optional() private readonly triggers?: ProviderTriggersService,
    ) {}

    /** Wakes the mailbox's trigger for one new mail row and completes it, in the caller's transaction. */
    async admit(tx: EntityManager, row: AdmittedRow): Promise<void> {
        const { owner } = row
        const pending = await this.intake.lockPending(tx, row.type, owner.connectionId, row.key)
        if (pending === null) return
        await this.wake(tx, row)
        await this.intake.complete(tx, pending)
    }

    /** Hands the stored mail to the mailbox's trigger. */
    private async wake(tx: EntityManager, row: AdmittedRow): Promise<void> {
        const { triggers } = this
        const { workspaceId, connectionId } = row.owner
        const parsed = IMAP_MAIL_TRIGGER.raw.safeParse(row.value)
        if (triggers === undefined || !parsed.success) return
        const event = IMAP_MAIL_TRIGGER.translate(parsed.data, { connectionId })
        if (event === null) {
            this.logger.info(DataHubLogEvent.MailNotFromPerson, { workspaceId, connectionId, notFromPerson: 1 })
            return
        }
        await triggers.deliver(
            {
                workspaceId,
                declaration: IMAP_MAIL_TRIGGER,
                connectionId,
                agentId: null,
                events: [{ event, raw: { type: row.type, id: row.id }, ...(event.data.at === null ? {} : { occurredAt: event.data.at }) }],
            },
            tx,
        )
    }
}
