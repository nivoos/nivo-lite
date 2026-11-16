import { Injectable, Optional } from "@nestjs/common"
import type { EntityManager } from "typeorm"
import { AccountDataIntakeService, type AccountAdmission, type AdmittedRow, type ArrivingRow } from "@modules/domain/account-data"
import { ProviderTriggersService, preparedWithRaw, type PreparedDelivery } from "@modules/domain/provider-triggers"
import { InjectLogger, type Logger } from "@modules/platform/logging"
import { DataHubLogEvent } from "./data-hub.log-events"
import { IMAP_MAIL_TRIGGER } from "./imap-mail.trigger"

/** A mail no person wrote (an auto-reply, a list, a bounce): no event, counted when its row is new. */
const NOT_FROM_PERSON = "not_from_person"

/** What PREPARE made of an arriving mail. */
type PreparedMail = PreparedDelivery | typeof NOT_FROM_PERSON | null

@Injectable()
/**
 * THE ADMISSION OF A NEW MAIL (owner R95; MAIL-IN rule MI-4; account-data rules 2, 7, 10): a new `imap.mail` row the one poll job kept is the
 * new signal; in the SAME transaction its stored value is handed to the mailbox's trigger and the row is completed. Nothing outside NIVO
 * happens between the row and the wake (the files of a mail stay at the mailbox), so no consumer job sits between them: the row and its
 * wake commit together or not at all. It is a PREPARED admission (concept outbox-job rule 12): the poll asks `prepare` for each arriving
 * mail with no transaction open (its pure translate, then the one delivery function's PREPARE: the sender met, the agents matched), and
 * runs the answer in the row's transaction (the delivery's COMMIT, then the row completed). A mail no person wrote is no event (the
 * translate's null) and is counted.
 */
export class MailAdmissionService {
    constructor(
        @InjectLogger() private readonly logger: Logger,
        private readonly intake: AccountDataIntakeService,
        @Optional() private readonly triggers?: ProviderTriggersService,
    ) {}

    /** PREPARE of one arriving mail (no transaction open): the admission its row runs if the intake answers it as new. */
    async prepare(row: ArrivingRow): Promise<AccountAdmission> {
        const prepared = await this.prepared(row)
        return (tx, admitted) => this.admit(tx, admitted, prepared)
    }

    /** Wakes the mailbox's trigger for one new mail row and completes it, in the caller's transaction. */
    private async admit(tx: EntityManager, row: AdmittedRow, prepared: PreparedMail): Promise<void> {
        const { owner } = row
        const pending = await this.intake.lockPending(tx, row.type, owner.connectionId, row.key)
        if (pending === null) return
        // Counted for a NEW row only (the poll prepares every mail it reads, kept before or not).
        if (prepared === NOT_FROM_PERSON)
            this.logger.info(DataHubLogEvent.MailNotFromPerson, {
                workspaceId: owner.workspaceId,
                connectionId: owner.connectionId,
                notFromPerson: 1,
            })
        else if (prepared !== null && this.triggers !== undefined)
            await this.triggers.deliver(preparedWithRaw(prepared, { type: row.type, id: row.id }), tx)
        await this.intake.complete(tx, pending)
    }

    /** The mail's delivery, prepared; `not_from_person` for a mail no person wrote, null for a row that is no mail. */
    private prepared(row: ArrivingRow): Promise<PreparedMail> {
        const { triggers } = this
        const { workspaceId, connectionId } = row.owner
        const parsed = IMAP_MAIL_TRIGGER.raw.safeParse(row.value)
        if (triggers === undefined || !parsed.success) return Promise.resolve(null)
        const event = IMAP_MAIL_TRIGGER.translate(parsed.data, { connectionId })
        if (event === null) return Promise.resolve(NOT_FROM_PERSON)
        return triggers.prepare({
            workspaceId,
            declaration: IMAP_MAIL_TRIGGER,
            connectionId,
            agentId: null,
            events: [{ event, ...(event.data.at === null ? {} : { occurredAt: event.data.at }) }],
        })
    }
}
